import * as chai from 'chai';
import {chaiSetup} from '../../../util/chai_setup';
import chxUtil = require('chxjs-util');
import * as BigNumber from 'bignumber.js';
import { constants } from '../../../util/constants';
import { Balances } from '../../../util/balances';
import { BNUtil } from '../../../util/bn_util';
import { crypto } from '../../../util/crypto';
import { ExchangeWrapper } from '../../../util/exchange_wrapper';
import { OrderFactory } from '../../../util/order_factory';
import { testUtil } from '../../../util/test_util';
import { Order } from '../../../util/order';
import { BalancesByOwner, ContractInstance, ExchangeContractErrs } from '../../../util/types';
import { Artifacts } from '../../../util/artifacts';

chaiSetup.configure();
const expect = chai.expect;

const {
  Exchange,
  Proxy,
  DummyToken,
  TokenRegistry,
} = new Artifacts(artifacts);

const { add, sub, mul, div, toSmallestUnits } = BNUtil;

contract('Exchange', (accounts: string[]) => {
  const maker = accounts[0];
  const tokenOwner = accounts[0];
  const taker = accounts[1] || accounts[accounts.length - 1];
  const feeRecipient = accounts[2] || accounts[accounts.length - 1];

  const INITIAL_BALANCE = toSmallestUnits(10000);
  const INITIAL_ALLOWANCE = toSmallestUnits(10000);

  let rep: ContractInstance;
  let dgd: ContractInstance;
  let zrx: ContractInstance;
  let exchange: ContractInstance;
  let tokenRegistry: ContractInstance;

  let order: Order;
  let balances: BalancesByOwner;
  let exWrapper: ExchangeWrapper;
  let dmyBalances: Balances;
  let orderFactory: OrderFactory;

  before(async () => {
    [tokenRegistry, exchange] = await Promise.all([
      TokenRegistry.deployed(),
      Exchange.deployed(),
    ]);
    exWrapper = new ExchangeWrapper(exchange);

    const [repAddress, dgdAddress, zrxAddress] = await Promise.all([
      tokenRegistry.getTokenAddressBySymbol('REP'),
      tokenRegistry.getTokenAddressBySymbol('DGD'),
      tokenRegistry.getTokenAddressBySymbol('ZRX'),
    ]);

    const defaultOrderParams = {
      exchangeContractAddress: Exchange.address,
      maker,
      feeRecipient,
      makerToken: repAddress,
      takerToken: dgdAddress,
      makerTokenAmount: toSmallestUnits(100),
      takerTokenAmount: toSmallestUnits(200),
      makerFee: toSmallestUnits(1),
      takerFee: toSmallestUnits(1),
    };
    orderFactory = new OrderFactory(defaultOrderParams);

    [rep, dgd, zrx] = await Promise.all([
      DummyToken.at(repAddress),
      DummyToken.at(dgdAddress),
      DummyToken.at(zrxAddress),
    ]);
    dmyBalances = new Balances([rep, dgd, zrx], [maker, taker, feeRecipient]);
    await Promise.all([
      rep.approve(Proxy.address, INITIAL_ALLOWANCE, { from: maker }),
      rep.approve(Proxy.address, INITIAL_ALLOWANCE, { from: taker }),
      rep.setBalance(maker, INITIAL_BALANCE, { from: tokenOwner }),
      rep.setBalance(taker, INITIAL_BALANCE, { from: tokenOwner }),
      dgd.approve(Proxy.address, INITIAL_ALLOWANCE, { from: maker }),
      dgd.approve(Proxy.address, INITIAL_ALLOWANCE, { from: taker }),
      dgd.setBalance(maker, INITIAL_BALANCE, { from: tokenOwner }),
      dgd.setBalance(taker, INITIAL_BALANCE, { from: tokenOwner }),
      zrx.approve(Proxy.address, INITIAL_ALLOWANCE, { from: maker }),
      zrx.approve(Proxy.address, INITIAL_ALLOWANCE, { from: taker }),
      zrx.setBalance(maker, INITIAL_BALANCE, { from: tokenOwner }),
      zrx.setBalance(taker, INITIAL_BALANCE, { from: tokenOwner }),
    ]);
  });

  describe('internal functions', () => {
    it('should include transferViaProxy', () => {
      expect(exchange.transferViaProxy).to.be.undefined();
    });

    it('should include isTransferable', () => {
      expect(exchange.isTransferable).to.be.undefined();
    });

    it('should include getBalance', () => {
      expect(exchange.getBalance).to.be.undefined();
    });

    it('should include getAllowance', () => {
      expect(exchange.getAllowance).to.be.undefined();
    });
  });

  describe('fillOrder', () => {
    beforeEach(async () => {
      balances = await dmyBalances.getAsync();
      order = await orderFactory.newSignedOrderAsync();
    });

    it('should transfer the correct amounts when makerTokenAmount === takerTokenAmount', async () => {
      order = await orderFactory.newSignedOrderAsync({
        makerTokenAmount: toSmallestUnits(100),
        takerTokenAmount: toSmallestUnits(100),
      });

      const filledTakerTokenAmountBefore = new BigNumber(await exchange.filled.call(order.params.orderHashHex));
      expect(filledTakerTokenAmountBefore, 'filledAmountMBefore should be 0').to.be.bignumber.equal(0);

      const fillTakerTokenAmount = order.params.takerTokenAmount.div(2);
      await exWrapper.fillOrderAsync(order, taker, { fillTakerTokenAmount });

      const filledTakerTokenAmountAfter = new BigNumber(await exchange.filled.call(order.params.orderHashHex));
      expect(filledTakerTokenAmountAfter, 'filledTakerTokenAmountAfter should be same as fillTakerTokenAmount')
        .to.be.bignumber.equal(fillTakerTokenAmount);

      const newBalances = await dmyBalances.getAsync();

      const fillMakerTokenAmount = div(mul(fillTakerTokenAmount, order.params.makerTokenAmount),
                                       order.params.takerTokenAmount);
      const paidMakerFee = div(mul(order.params.makerFee, fillMakerTokenAmount), order.params.makerTokenAmount);
      const paidTakerFee = div(mul(order.params.takerFee, fillMakerTokenAmount), order.params.makerTokenAmount);
      expect(newBalances[maker][order.params.makerToken])
        .to.be.bignumber.equal(sub(balances[maker][order.params.makerToken], fillMakerTokenAmount));
      expect(newBalances[maker][order.params.takerToken])
        .to.be.bignumber.equal(add(balances[maker][order.params.takerToken], fillTakerTokenAmount));
      expect(newBalances[maker][zrx.address]).to.be.bignumber.equal(sub(balances[maker][zrx.address], paidMakerFee));
      expect(newBalances[taker][order.params.takerToken])
        .to.be.bignumber.equal(sub(balances[taker][order.params.takerToken], fillTakerTokenAmount));
      expect(newBalances[taker][order.params.makerToken])
        .to.be.bignumber.equal(add(balances[taker][order.params.makerToken], fillMakerTokenAmount));
      expect(newBalances[taker][zrx.address]).to.be.bignumber.equal(sub(balances[taker][zrx.address], paidTakerFee));
      expect(newBalances[feeRecipient][zrx.address])
        .to.be.bignumber.equal(add(balances[feeRecipient][zrx.address], add(paidMakerFee, paidTakerFee)));
    });

    it('should transfer the correct amounts when makerTokenAmount > takerTokenAmount', async () => {
      order = await orderFactory.newSignedOrderAsync({
        makerTokenAmount: toSmallestUnits(200),
        takerTokenAmount: toSmallestUnits(100),
      });

      const filledTakerTokenAmountBefore = new BigNumber(await exchange.filled.call(order.params.orderHashHex));
      expect(filledTakerTokenAmountBefore, 'filledTakerTokenAmountBefore should be 0').to.be.bignumber.equal(0);

      const fillTakerTokenAmount = order.params.takerTokenAmount.div(2);
      await exWrapper.fillOrderAsync(order, taker, { fillTakerTokenAmount });

      const filledTakerTokenAmountAfter = new BigNumber(await exchange.filled.call(order.params.orderHashHex));
      expect(
          filledTakerTokenAmountAfter,
          'filledTakerTokenAmountAfter should be same as fillTakerTokenAmount',
      ).to.be.bignumber.equal(fillTakerTokenAmount.toString());

      const newBalances = await dmyBalances.getAsync();

      const fillMakerTokenAmount = div(mul(fillTakerTokenAmount, order.params.makerTokenAmount),
                                       order.params.takerTokenAmount);
      const paidMakerFee = div(mul(order.params.makerFee, fillMakerTokenAmount), order.params.makerTokenAmount);
      const paidTakerFee = div(mul(order.params.takerFee, fillMakerTokenAmount), order.params.makerTokenAmount);
      expect(newBalances[maker][order.params.makerToken])
        .to.be.bignumber.equal(sub(balances[maker][order.params.makerToken], fillMakerTokenAmount));
      expect(newBalances[maker][order.params.takerToken])
        .to.be.bignumber.equal(add(balances[maker][order.params.takerToken], fillTakerTokenAmount));
      expect(newBalances[maker][zrx.address]).to.be.bignumber.equal(sub(balances[maker][zrx.address], paidMakerFee));
      expect(newBalances[taker][order.params.takerToken])
        .to.be.bignumber.equal(sub(balances[taker][order.params.takerToken], fillTakerTokenAmount));
      expect(newBalances[taker][order.params.makerToken])
        .to.be.bignumber.equal(add(balances[taker][order.params.makerToken], fillMakerTokenAmount));
      expect(newBalances[taker][zrx.address]).to.be.bignumber.equal(sub(balances[taker][zrx.address], paidTakerFee));
      expect(newBalances[feeRecipient][zrx.address])
        .to.be.bignumber.equal(add(balances[feeRecipient][zrx.address], add(paidMakerFee, paidTakerFee)));
    });

    it('should transfer the correct amounts when makerTokenAmount < takerTokenAmount', async () => {
      order = await orderFactory.newSignedOrderAsync({
        makerTokenAmount: toSmallestUnits(100),
        takerTokenAmount: toSmallestUnits(200),
      });

      const filledTakerTokenAmountBefore = new BigNumber(await exchange.filled.call(order.params.orderHashHex));
      expect(filledTakerTokenAmountBefore, 'filledTakerTokenAmountBefore should be 0').to.be.bignumber.equal(0);

      const fillTakerTokenAmount = order.params.takerTokenAmount.div(2);
      await exWrapper.fillOrderAsync(order, taker, { fillTakerTokenAmount });

      const filledTakerTokenAmountAfter = new BigNumber(await exchange.filled.call(order.params.orderHashHex));
      expect(filledTakerTokenAmountAfter, 'filledTakerTokenAmountAfter should be same as fillTakerTokenAmount')
        .to.be.bignumber.equal(fillTakerTokenAmount.toString());

      const newBalances = await dmyBalances.getAsync();

      const fillMakerTokenAmount = div(mul(fillTakerTokenAmount, order.params.makerTokenAmount),
                                       order.params.takerTokenAmount);
      const paidMakerFee = div(mul(order.params.makerFee, fillMakerTokenAmount), order.params.makerTokenAmount);
      const paidTakerFee = div(mul(order.params.takerFee, fillMakerTokenAmount), order.params.makerTokenAmount);
      expect(newBalances[maker][order.params.makerToken])
        .to.be.bignumber.equal(sub(balances[maker][order.params.makerToken], fillMakerTokenAmount));
      expect(newBalances[maker][order.params.takerToken])
        .to.be.bignumber.equal(add(balances[maker][order.params.takerToken], fillTakerTokenAmount));
      expect(newBalances[maker][zrx.address])
        .to.be.bignumber.equal(sub(balances[maker][zrx.address], paidMakerFee));
      expect(newBalances[taker][order.params.takerToken])
        .to.be.bignumber.equal(sub(balances[taker][order.params.takerToken], fillTakerTokenAmount));
      expect(newBalances[taker][order.params.makerToken])
        .to.be.bignumber.equal(add(balances[taker][order.params.makerToken], fillMakerTokenAmount));
      expect(newBalances[taker][zrx.address])
        .to.be.bignumber.equal(sub(balances[taker][zrx.address], paidTakerFee));
      expect(newBalances[feeRecipient][zrx.address])
        .to.be.bignumber.equal(add(balances[feeRecipient][zrx.address], add(paidMakerFee, paidTakerFee)));
    });

    it('should transfer the correct amounts when taker is specified and order is claimed by taker', async () => {
      order = await orderFactory.newSignedOrderAsync({
        taker,
        makerTokenAmount: toSmallestUnits(100),
        takerTokenAmount: toSmallestUnits(200),
      });

      const filledTakerTokenAmountBefore = new BigNumber(await exchange.filled.call(order.params.orderHashHex));
      expect(filledTakerTokenAmountBefore, 'filledTakerTokenAmountBefore should be 0').to.be.bignumber.equal(0);

      const fillTakerTokenAmount = order.params.takerTokenAmount.div(2);
      await exWrapper.fillOrderAsync(order, taker, { fillTakerTokenAmount });

      const filledTakerTokenAmountAfter = new BigNumber(await exchange.filled.call(order.params.orderHashHex));
      const expectedFillAmountTAfter = add(fillTakerTokenAmount, filledTakerTokenAmountBefore);
      expect(
          filledTakerTokenAmountAfter,
          'filledTakerTokenAmountAfter should be same as fillTakerTokenAmount',
      ).to.be.bignumber.equal(expectedFillAmountTAfter);

      const newBalances = await dmyBalances.getAsync();

      const fillMakerTokenAmount = div(mul(fillTakerTokenAmount, order.params.makerTokenAmount),
                                       order.params.takerTokenAmount);
      const paidMakerFee = div(mul(order.params.makerFee, fillMakerTokenAmount), order.params.makerTokenAmount);
      const paidTakerFee = div(mul(order.params.takerFee, fillMakerTokenAmount), order.params.makerTokenAmount);
      expect(newBalances[maker][order.params.makerToken])
        .to.be.bignumber.equal(sub(balances[maker][order.params.makerToken], fillMakerTokenAmount));
      expect(newBalances[maker][order.params.takerToken])
        .to.be.bignumber.equal(add(balances[maker][order.params.takerToken], fillTakerTokenAmount));
      expect(newBalances[maker][zrx.address])
        .to.be.bignumber.equal(sub(balances[maker][zrx.address], paidMakerFee));
      expect(newBalances[taker][order.params.takerToken])
        .to.be.bignumber.equal(sub(balances[taker][order.params.takerToken], fillTakerTokenAmount));
      expect(newBalances[taker][order.params.makerToken])
        .to.be.bignumber.equal(add(balances[taker][order.params.makerToken], fillMakerTokenAmount));
      expect(newBalances[taker][zrx.address])
        .to.be.bignumber.equal(sub(balances[taker][zrx.address], paidTakerFee));
      expect(newBalances[feeRecipient][zrx.address])
        .to.be.bignumber.equal(add(balances[feeRecipient][zrx.address], add(paidMakerFee, paidTakerFee)));
    });

    it('should fill remaining value if fillTakerTokenAmount > remaining takerTokenAmount', async () => {
      const fillTakerTokenAmount = order.params.takerTokenAmount.div(2);
      await exWrapper.fillOrderAsync(order, taker, { fillTakerTokenAmount });

      const res = await exWrapper.fillOrderAsync(order, taker, { fillTakerTokenAmount: order.params.takerTokenAmount });

      expect(res.logs[0].args.filledTakerTokenAmount.toString())
        .to.be.bignumber.equal(sub(order.params.takerTokenAmount, fillTakerTokenAmount));
      const newBalances = await dmyBalances.getAsync();

      expect(newBalances[maker][order.params.makerToken])
        .to.be.bignumber.equal(sub(balances[maker][order.params.makerToken], order.params.makerTokenAmount));
      expect(newBalances[maker][order.params.takerToken])
        .to.be.bignumber.equal(add(balances[maker][order.params.takerToken], order.params.takerTokenAmount));
      expect(newBalances[maker][zrx.address])
        .to.be.bignumber.equal(sub(balances[maker][zrx.address], order.params.makerFee));
      expect(newBalances[taker][order.params.takerToken])
        .to.be.bignumber.equal(sub(balances[taker][order.params.takerToken], order.params.takerTokenAmount));
      expect(newBalances[taker][order.params.makerToken])
        .to.be.bignumber.equal(add(balances[taker][order.params.makerToken], order.params.makerTokenAmount));
      expect(newBalances[taker][zrx.address])
        .to.be.bignumber.equal(sub(balances[taker][zrx.address], order.params.takerFee));
      expect(newBalances[feeRecipient][zrx.address])
        .to.be.bignumber.equal(
            add(balances[feeRecipient][zrx.address], add(order.params.makerFee, order.params.takerFee)));
    });

    it('should log 1 event with the correct arguments when order has a feeRecipient', async () => {
      const divisor = 2;
      const res = await exWrapper.fillOrderAsync(order, taker,
                                            { fillTakerTokenAmount: order.params.takerTokenAmount.div(divisor) });
      expect(res.logs).to.have.lengthOf(1);

      const logArgs = res.logs[0].args;
      const expectedFilledMakerTokenAmount = order.params.makerTokenAmount.div(divisor);
      const expectedFilledTakerTokenAmount = order.params.takerTokenAmount.div(divisor);
      const expectedFeeMPaid = order.params.makerFee.div(divisor);
      const expectedFeeTPaid = order.params.takerFee.div(divisor);
      const tokensHashBuff = crypto.solSHA3([order.params.makerToken, order.params.takerToken]);
      const expectedTokens = chxUtil.bufferToHex(tokensHashBuff);

      expect(order.params.maker).to.be.equal(logArgs.maker);
      expect(taker).to.be.equal(logArgs.taker);
      expect(order.params.feeRecipient).to.be.equal(logArgs.feeRecipient);
      expect(order.params.makerToken).to.be.equal(logArgs.makerToken);
      expect(order.params.takerToken).to.be.equal(logArgs.takerToken);
      expect(expectedFilledMakerTokenAmount.toString()).to.be.equal(logArgs.filledMakerTokenAmount.toString());
      expect(expectedFilledTakerTokenAmount.toString()).to.be.equal(logArgs.filledTakerTokenAmount.toString());
      expect(expectedFeeMPaid.toString()).to.be.equal(logArgs.paidMakerFee.toString());
      expect(expectedFeeTPaid.toString()).to.be.equal(logArgs.paidTakerFee.toString());
      expect(expectedTokens).to.be.equal(logArgs.tokens);
      expect(order.params.orderHashHex).to.be.equal(logArgs.orderHash);
    });

    it('should log 1 event with the correct arguments when order has no feeRecipient', async () => {
      order = await orderFactory.newSignedOrderAsync({
        feeRecipient: constants.NULL_ADDRESS,
      });
      const divisor = 2;
      const res = await exWrapper.fillOrderAsync(order, taker,
                                            { fillTakerTokenAmount: order.params.takerTokenAmount.div(divisor) });
      expect(res.logs).to.have.lengthOf(1);

      const logArgs = res.logs[0].args;
      const expectedFilledMakerTokenAmount = order.params.makerTokenAmount.div(divisor);
      const expectedFilledTakerTokenAmount = order.params.takerTokenAmount.div(divisor);
      const expectedFeeMPaid = new BigNumber(0);
      const expectedFeeTPaid = new BigNumber(0);
      const tokensHashBuff = crypto.solSHA3([order.params.makerToken, order.params.takerToken]);
      const expectedTokens = chxUtil.bufferToHex(tokensHashBuff);

      expect(order.params.maker).to.be.equal(logArgs.maker);
      expect(taker).to.be.equal(logArgs.taker);
      expect(order.params.feeRecipient).to.be.equal(logArgs.feeRecipient);
      expect(order.params.makerToken).to.be.equal(logArgs.makerToken);
      expect(order.params.takerToken).to.be.equal(logArgs.takerToken);
      expect(expectedFilledMakerTokenAmount.toString()).to.be.equal(logArgs.filledMakerTokenAmount.toString());
      expect(expectedFilledTakerTokenAmount.toString()).to.be.equal(logArgs.filledTakerTokenAmount.toString());
      expect(expectedFeeMPaid.toString()).to.be.equal(logArgs.paidMakerFee.toString());
      expect(expectedFeeTPaid.toString()).to.be.equal(logArgs.paidTakerFee.toString());
      expect(expectedTokens).to.be.equal(logArgs.tokens);
      expect(order.params.orderHashHex).to.be.equal(logArgs.orderHash);
    });

    it('should throw when taker is specified and order is claimed by other', async () => {
      order = await orderFactory.newSignedOrderAsync({
        taker: feeRecipient,
        makerTokenAmount: toSmallestUnits(100),
        takerTokenAmount: toSmallestUnits(200),
      });

      try {
        await exWrapper.fillOrderAsync(order, taker);
        throw new Error('Fill succeeded when it should have thrown');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should throw if signature is invalid', async () => {
      order = await orderFactory.newSignedOrderAsync({
        makerTokenAmount: toSmallestUnits(10),
      });

      try {
        await exWrapper.fillOrderAsync(order, taker);
        throw new Error('Fill succeeded when it should have thrown');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should not change balances if maker balances are too low to fill order and \
        shouldThrowOnInsufficientBalanceOrAllowance = false',
       async () => {
      order = await orderFactory.newSignedOrderAsync({
        makerTokenAmount: toSmallestUnits(100000),
      });

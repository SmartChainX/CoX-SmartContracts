import * as chai from 'chai';
import {chaiSetup} from '../../util/chai_setup';
import Web3 = require('web3');
import * as BigNumber from 'bignumber.js';
import * as _ from 'lodash';
import promisify = require('es6-promisify');
import ethUtil = require('ethereumjs-util');
import { Balances } from '../../util/balances';
import { crypto } from '../../util/crypto';
import { BNUtil } from '../../util/bn_util';
import { testUtil } from '../../util/test_util';
import { Order } from '../../util/order';
import { BalancesByOwner, ContractInstance, OrderParams } from '../../util/types';
import { Artifacts } from '../../util/artifacts';
import { constants } from '../../util/constants';

chaiSetup.configure();
const expect = chai.expect;

const {
  TokenDistributionWithRegistry,
  TokenRegistry,
  Exchange,
  DummyToken,
  Proxy,
} = new Artifacts(artifacts);

const { add, sub, mul, div, cmp, toSmallestUnits } = BNUtil;

// In order to benefit from type-safety, we re-assign the global web3 instance injected by Truffle
// with type `any` to a variable of type `Web3`.
const web3Instance: Web3 = web3;

contract('TokenDistributionWithRegistry', (accounts: string[]) => {
  const maker = accounts[0];
  const taker = accounts[1];
  const owner = accounts[0];
  const notOwner = accounts[1];

  let ethCapPerAddress = new BigNumber(web3Instance.toWei(1, 'ether'));
  const gasPrice = new BigNumber(web3Instance.toWei(20, 'gwei'));

  let tokenRegistry: ContractInstance;
  let tokenDistributionWithRegistry: ContractInstance;
  let exchange: ContractInstance;
  let zrx: ContractInstance;
  let wEth: ContractInstance;

  let invalidTokenAddress: string;
  let zrxAddress: string;
  let wEthAddress: string;

  let validOrder: Order;
  let validOrderParams: OrderParams;
  let dmyBalances: Balances;

  const sendTransactionAsync = promisify(web3Instance.eth.sendTransaction);
  const getEthBalanceAsync = promisify(web3Instance.eth.getBalance);
  const getTransactionReceiptAsync = promisify(web3Instance.eth.getTransactionReceipt);

  before(async () => {
    [exchange, tokenRegistry] = await Promise.all([
      Exchange.deployed(),
      TokenRegistry.deployed(),
    ]);
    [zrxAddress, wEthAddress, invalidTokenAddress] = await Promise.all([
      tokenRegistry.getTokenAddressBySymbol('ZRX'),
      tokenRegistry.getTokenAddressBySymbol('WETH'),
      tokenRegistry.getTokenAddressBySymbol('REP'),
    ]);
    tokenDistributionWithRegistry = await TokenDistributionWithRegistry.new(
      Exchange.address,
      Proxy.address,
      zrxAddress,
      wEthAddress,
      ethCapPerAddress,
    );

    const expirationInFuture = new BigNumber(Math.floor(Date.now() / 1000) + 1000000000);

    validOrderParams = {
      exchangeContractAddress: Exchange.address,
      maker,
      taker: tokenDistributionWithRegistry.address,
      feeRecipient: constants.NULL_ADDRESS,
      makerToken: zrxAddress,
      takerToken: wEthAddress,
      makerTokenAmount: toSmallestUnits(2),
      takerTokenAmount: toSmallestUnits(2),
      makerFee: new BigNumber(0),
      takerFee: new BigNumber(0),
      expirationTimestampInSec: expirationInFuture,
      salt: new BigNumber(0),
    };
    validOrder = new Order(validOrderParams);
    await validOrder.signAsync();

    [zrx, wEth] = await Promise.all([
      DummyToken.at(zrxAddress),
      DummyToken.at(wEthAddress),
    ]);
    dmyBalances = new Balances([zrx, wEth], [maker, taker]);
    await Promise.all([
      zrx.approve(Proxy.address, mul(validOrder.params.makerTokenAmount, 100), { from: maker }),
      zrx.setBalance(maker, mul(validOrder.params.makerTokenAmount, 100), { from: owner }),
    ]);
  });

  describe('init', () => {
    it('should throw when not called by owner', async () => {
      const params = validOrder.createFill();
      try {
        await tokenDistributionWithRegistry.init(
          params.orderAddresses,
          params.orderValues,
          params.v,
          params.r,
          params.s,
          { from: notOwner },
        );
        throw new Error('init succeeded when it should have thrown');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should throw if called with an invalid order signature', async () => {
      try {
        const params = validOrder.createFill();
        const invalidR = ethUtil.bufferToHex(ethUtil.sha3('invalidR'));
        await tokenDistributionWithRegistry.init(
          params.orderAddresses,
          params.orderValues,
          params.v,
          invalidR,
          params.s,
        );
        throw new Error('init succeeded when it should have thrown');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should throw without the makerToken set to the protocol token', async () => {
      const invalidOrderParams: OrderParams = _.assign({}, validOrderParams, { makerToken: invalidTokenAddress });
      const newOrder = new Order(invalidOrderParams);
      await newOrder.signAsync();
      const params = newOrder.createFill();

      try {
        await tokenDistributionWithRegistry.init(
          params.orderAddresses,
          params.orderValues,
          params.v,
          params.r,
          params.s,
        );
        throw new Error('init succeeded when it should have thrown');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should throw if called without the takerToken set to the wrapped ETH token', async () => {
      const invalidOrderParams: OrderParams = _.assign({}, validOrderParams, { takerToken: invalidTokenAddress });
      const newOrder = new Order(invalidOrderParams);
      await newOrder.signAsync();
      const params = newOrder.createFill();

      try {
        await tokenDistributionWithRegistry.init(
          params.orderAddresses,
          params.orderValues,
          params.v,
          params.r,
          params.s,
        );
        throw new Error('init succeeded when it should have thrown');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should throw if the order taker is not the crowdsale contract address', async () => {
      const invalidOrderParams: OrderParams = _.assign({}, validOrderParams, { taker: constants.NULL_ADDRESS });
      const invalidOrder = new Order(invalidOrderParams);
      await invalidOrder.signAsync();
      const params = invalidOrder.createFill();
      try {
        await tokenDistributionWithRegistry.init(
          params.orderAddresses,
          params.orderValues,
          params.v,
          params.r,
          params.s,
          { from: owner },
        );
        throw new Error('init succeeded when it should have thrown');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should initialize the sale with valid order params and log correct args', async () => {
      const params = validOrder.createFill();
      const res = await tokenDistributionWithRegistry.init(
        params.orderAddresses,
        params.orderValues,
        params.v,
        params.r,
        params.s,
        { from: owner },
      );

      expect(res.logs, 'Expected a single event to fire when the sale is successfully initialized').to.have.lengthOf(1);
      const logArgs = res.logs[0].args;
      expect(logArgs.maker).to.be.equal(validOrder.params.maker);
      expect(logArgs.taker).to.be.equal(validOrder.params.taker);
      expect(logArgs.makerToken).to.be.equal(validOrder.params.makerToken);
      expect(logArgs.takerToken).to.be.equal(validOrder.params.takerToken);
      expect(logArgs.feeRecipient).to.be.equal(validOrder.params.feeRecipient);
      expect(logArgs.makerTokenAmount.toString()).to.be.bignumber.equal(validOrder.params.makerTokenAmount);
      expect(logArgs.takerTokenAmount.toString()).to.be.bignumber.equal(validOrder.params.takerTokenAmount);
      expect(logArgs.makerFee.toString()).to.be.bignumber.equal(validOrder.params.makerFee);
      expect(logArgs.takerFee.toString()).to.be.bignumber.equal(validOrder.params.takerFee);
      expect(logArgs.expirationTimestampInSec.toString())
        .to.be.bignumber.equal(validOrder.params.expirationTimestampInSec);
      expect(logArgs.salt.toString()).to.be.bignumber.equal(validOrder.params.salt);
      expect(logArgs.v.toNumber()).to.be.equal(validOrder.params.v);
      expect(logArgs.r).to.be.equal(validOrder.params.r);
      expect(logArgs.s).to.be.equal(validOrder.params.s);

      const isInitialized = await tokenDistributionWithRegistry.isInitialized.call();
      expect(isInitialized).to.be.true();
    });

    it('should throw if the sale has already been initialized', async () => {
      const params = validOrder.createFill();
      try {
        await tokenDistributionWithRegistry.init(
          params.orderAddresses,
          params.orderValues,
          params.v,
          params.r,
          params.s,
          { from: owner },
        );
        throw new Error('init succeeded when it should have thrown');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });
  });

  describe('changeRegistrationStatus', () => {
    it('should throw if not called by owner', async () => {
      try {
        const isRegistered = true;
        await tokenDistributionWithRegistry.changeRegistrationStatus(taker, isRegistered, { from: notOwner });
        throw new Error('changeRegistrationStatus succeeded when it should have thrown');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should change registration status of an address if called by owner', async () => {
      let isRegistered = true;
      await tokenDistributionWithRegistry.changeRegistrationStatus(taker, isRegistered, { from: owner });
      let isTakerRegistered = await tokenDistributionWithRegistry.registered.call(taker);
      expect(isTakerRegistered).to.be.true();

      isRegistered = false;
      await tokenDistributionWithRegistry.changeRegistrationStatus(taker, isRegistered, { from: owner });
      isTakerRegistered = await tokenDistributionWithRegistry.registered.call(taker);
      expect(isTakerRegistered).to.be.false();
    });
  });

  describe('changeRegistrationStatuses', () => {
    it('should throw if not called by owner', async () => {
      const isRegistered = true;
      try {
        await tokenDistributionWithRegistry.changeRegistrationStatuses([taker], isRegistered, { from: notOwner });
        throw new Error('changeRegistrationStatuses succeeded when it should have thrown');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should change registration statuses of addresses if called by owner', async () => {
      let isRegistered = true;
      await tokenDistributionWithRegistry.changeRegistrationStatuses([maker, taker], isRegistered, { from: owner });
      let isMakerRegistered = await tokenDistributionWithRegistry.registered.call(maker);
      let isTakerRegistered = await tokenDistributionWithRegistry.registered.call(taker);
      expect(isMakerRegistered).to.be.true();
      expect(isTakerRegistered).to.be.true();

      isRegistered = false;
      await tokenDistributionWithRegistry.changeRegistrationStatuses([maker, taker], isRegistered, { from: owner });
      isMakerRegistered = await tokenDistributionWithRegistry.registered.call(maker);
      isTakerRegistered = await tokenDistributionWithRegistry.registered.call(taker);
      expect(isMakerRegistered).to.be.false();
      expect(isTakerRegistered).to.be.false();
    });
  });

  describe('setCapPerAddress', () => {
    it('should throw if not called by owner', async () => {
      try {
        const newCapPerAddress = web3Instance.toWei(1.1, 'ether');
        await tokenDistributionWithRegistry.setCapPerAddress(newCapPerAddress, { from: notOwner });
        throw new Error('setCapPerAddress succeeded when it should have thrown');
      } catch (err) {
        testUtil.assertThrow(err);
      }
    });

    it('should set a new ethCapPerAddress if called by owner', async () => {
      const newCapPerAddress = new BigNumber(web3Instance.toWei(1.1, 'ether'));
      await tokenDistributionWithRegistry.setCapPerAddress(newCapPerAddress, { from: owner });
      ethCapPerAddress = new BigNumber(await tokenDistributionWithRegistry.ethCapPerAddress.call());
      expect(newCapPerAddress).to.be.bignumber.equal(ethCapPerAddress);
    });
  });

  describe('contributing', () => {
    beforeEach(async () => {
      tokenDistributionWithRegistry = await TokenDistributionWithRegistry.new(
        Exchange.address,
        Proxy.address,
        zrxAddress,
        wEthAddress,
        ethCapPerAddress,
        { from: owner },
      );
      const isRegistered = true;
      await tokenDistributionWithRegistry.changeRegistrationStatus(taker, isRegistered, { from: owner });

      validOrderParams = _.assign({}, validOrderParams, { taker: tokenDistributionWithRegistry.address });
      validOrder = new Order(validOrderParams);
      await validOrder.signAsync();
      const params = validOrder.createFill();

      await tokenDistributionWithRegistry.init(
        params.orderAddresses,
        params.orderValues,
        params.v,
        params.r,
        params.s,
        { from: owner },
      );
    });

    describe('fillOrderWithEth', () => {
      it('should throw if sale not initialized', async () => {
        tokenDistributionWithRegistry = await TokenDistributionWithRegistry.new(
          Exchange.address,
          Proxy.address,
          zrxAddress,
          wEthAddress,
          ethCapPerAddress,
          { from: owner },
        );
        try {
          const ethValue = new BigNumber(1);
          await tokenDistributionWithRegistry.fillOrderWithEth({
            from: taker,
            value: ethValue,
          });
          throw new Error('Fallback succeeded when it should have thrown');
        } catch (err) {
          testUtil.assertThrow(err);
        }
      });

      it('should throw if the caller is not registered', async () => {
        const isRegistered = false;
        await tokenDistributionWithRegistry.changeRegistrationStatus(taker, false, { from: owner });
        try {
          const ethValue = new BigNumber(1);
          await tokenDistributionWithRegistry.fillOrderWithEth({
            from: taker,
            value: ethValue,
          });
          throw new Error('Fallback succeeded when it should have thrown');
        } catch (err) {
          testUtil.assertThrow(err);
        }
      });

      it('should trade sent ETH for protocol tokens if ETH <= remaining order ETH and ethCapPerAddress',
         async () => {
        const initBalances: BalancesByOwner = await dmyBalances.getAsync();
        const initTakerEthBalance = await getEthBalanceAsync(taker);

        const ethValue = web3Instance.toWei(1, 'ether');
        const zrxValue = div(mul(ethValue, validOrder.params.makerTokenAmount), validOrder.params.takerTokenAmount);

        const res = await tokenDistributionWithRegistry.fillOrderWithEth({
          from: taker,
          value: ethValue,
          gasPrice,
        });

        const finalBalances: BalancesByOwner = await dmyBalances.getAsync();
        const finalTakerEthBalance = new BigNumber(await getEthBalanceAsync(taker));
        const ethSpentOnGas = mul(res.receipt.gasUsed, gasPrice);

        expect(finalBalances[maker][validOrder.params.makerToken])
            .to.be.equal(sub(initBalances[maker][validOrder.params.makerToken], zrxValue));
        expect(finalBalances[maker][validOrder.params.takerToken])
            .to.be.equal(add(initBalances[maker][validOrder.params.takerToken], ethValue));
        expect(finalBalances[taker][validOrder.params.makerToken])
            .to.be.equal(add(initBalances[taker][validOrder.params.makerToken], zrxValue));
        expect(finalTakerEthBalance).to.be.bignumber.equal(sub(sub(initTakerEthBalance, ethValue), ethSpentOnGas));
      });

      it('should fill the remaining ethCapPerAddress if sent > than the remaining ethCapPerAddress',
         async () => {
        const initBalances: BalancesByOwner = await dmyBalances.getAsync();
        const initTakerEthBalance = await getEthBalanceAsync(taker);
        const ethValue = add(ethCapPerAddress, 1);

        const res = await tokenDistributionWithRegistry.fillOrderWithEth({
          from: taker,
          value: ethValue,
          gasPrice,
        });

        const finalBalances: BalancesByOwner = await dmyBalances.getAsync();
        const finalTakerEthBalance = new BigNumber(await getEthBalanceAsync(taker));
        const ethSpentOnGas = mul(res.receipt.gasUsed, gasPrice);
        const filledZrxValue = ethCapPerAddress;
        const filledEthValue = ethCapPerAddress;

        expect(finalBalances[maker][validOrder.params.makerToken])
            .to.be.equal(sub(initBalances[maker][validOrder.params.makerToken], filledZrxValue));
        expect(finalBalances[maker][validOrder.params.takerToken])
            .to.be.equal(add(initBalances[maker][validOrder.params.takerToken], filledEthValue));
        expect(finalBalances[taker][validOrder.params.makerToken])
            .to.be.equal(add(initBalances[taker][validOrder.params.makerToken], filledZrxValue));
        expect(finalTakerEthBalance)
            .to.be.bignumber.equal(sub(sub(initTakerEthBalance, filledEthValue), ethSpentOnGas));
      });

      it('should partial fill and end sale if sender is registered and sent ETH > remaining order ETH', async () => {
        const newCapPerAddress = mul(validOrder.params.makerTokenAmount, 2);
        await tokenDistributionWithRegistry.setCapPerAddress(newCapPerAddress, { from: owner });
        const initBalances: BalancesByOwner = await dmyBalances.getAsync();
        const initTakerEthBalance = await getEthBalanceAsync(taker);

        const ethValue = add(validOrder.params.takerTokenAmount, 1);

        const res = await tokenDistributionWithRegistry.fillOrderWithEth({
          from: taker,
          value: ethValue,
          gasPrice,
        });
        const finalBalances: BalancesByOwner = await dmyBalances.getAsync();
        const finalTakerEthBalance = new BigNumber(await getEthBalanceAsync(taker));
        const ethSpentOnGas = mul(res.receipt.gasUsed, gasPrice);
        const filledZrxValue = validOrder.params.makerTokenAmount;
        const filledEthValue = validOrder.params.takerTokenAmount;

        expect(finalBalances[maker][validOrder.params.makerToken])
            .to.be.equal(sub(initBalances[maker][validOrder.params.makerToken], filledZrxValue));
        expect(finalBalances[maker][validOrder.params.takerToken])
            .to.be.equal(add(initBalances[maker][validOrder.params.takerToken], filledEthValue));
        expect(finalBalances[taker][validOrder.params.makerToken])
            .to.be.equal(add(initBalances[taker][validOrder.params.makerToken], filledZrxValue));
        expect(finalTakerEthBalance)
            .to.be.bignumber.equal(sub(sub(initTakerEthBalance, filledEthValue), ethSpentOnGas));

        expect(
            res.receipt.logs,
            'Expected 5 events to fire when the sale is successfully initialized',
        ).to.have.lengthOf(5);
        const finishedLog = res.receipt.logs[4];
        const funcSig = finishedLog.topics[0].slice(2, 10);
        const expectedFuncSig = crypto.solSHA3(['Finished()']).slice(0, 4).toString('hex');
        expect(funcSig).to.be.equal(expectedFuncSig);

        const isFinished = await tokenDistributionWithRegistry.isFinished.call();
        expect(isFinished).to.be.true();
      });

      it('should throw if sale has ended', async () => {
        const newCapPerAddress = mul(validOrder.params.makerTokenAmount, 2);
        await tokenDistributionWithRegistry.setCapPerAddress(newCapPerAddress, { from: owner });

        const ethValue = add(validOrder.params.takerTokenAmount, 1);

        await tokenDistributionWithRegistry.fillOrderWithEth({
          from: taker,
          value: ethValue,
          gasPrice,
        });

        const isFinished = await tokenDistributionWithRegistry.isFinished.call();
        expect(isFinished).to.be.true();

        try {
          const newEthValue = new BigNumber(1);
          await tokenDistributionWithRegistry.fillOrderWithEth({
            from: taker,
            value: newEthValue,
          });
          throw new Error('Fallback succeeded when it should have thrown');
        } catch (err) {
          testUtil.assertThrow(err);
        }
      });
    });

    describe('fallback', () => {
      it('should trade sent ETH for protocol tokens if ETH <= remaining order ETH and ethCapPerAddress',
         async () => {
        const initBalances: BalancesByOwner = await dmyBalances.getAsync();
        const initTakerEthBalance = await getEthBalanceAsync(taker);

        const ethValue = web3Instance.toWei(1, 'ether');
        const zrxValue = div(mul(ethValue, validOrder.params.makerTokenAmount), validOrder.params.takerTokenAmount);

        const gas = 300000;

        const txHash = await sendTransactionAsync({
          from: taker,
          to: tokenDistributionWithRegistry.address,
          value: ethValue,
          gas,
          gasPrice,
        });
        const receipt = await getTransactionReceiptAsync(txHash);

        const finalBalances: BalancesByOwner = await dmyBalances.getAsync();
        const finalTakerEthBalance = new BigNumber(await getEthBalanceAsync(taker));
        const ethSpentOnGas = mul(receipt.gasUsed, gasPrice);

        expect(finalBalances[maker][validOrder.params.makerToken])
            .to.be.equal(sub(initBalances[maker][validOrder.params.makerToken], zrxValue));
        expect(finalBalances[maker][validOrder.params.takerToken])
            .to.be.equal(add(initBalances[maker][validOrder.params.takerToken], ethValue));
        expect(finalBalances[taker][validOrder.params.makerToken])
            .to.be.equal(add(initBalances[taker][validOrder.params.makerToken], zrxValue));
        expect(finalTakerEthBalance).to.be.bignumber.equal(sub(sub(initTakerEthBalance, ethValue), ethSpentOnGas));
      });
    });
  });
});

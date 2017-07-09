import * as chai from 'chai';
import {chaiSetup} from '../../../util/chai_setup';
import { BNUtil } from '../../../util/bn_util';
import { ExchangeWrapper } from '../../../util/exchange_wrapper';
import { OrderFactory } from '../../../util/order_factory';
import { Order } from '../../../util/order';
import { Artifacts } from '../../../util/artifacts';

chaiSetup.configure();
const expect = chai.expect;

const {
  Exchange,
  TokenRegistry,
} = new Artifacts(artifacts);

const { toSmallestUnits } = BNUtil;

contract('Exchange', (accounts: string[]) => {
  const maker = accounts[0];
  const feeRecipient = accounts[1] || accounts[accounts.length - 1];

  let order: Order;
  let exWrapper: ExchangeWrapper;
  let orderFactory: OrderFactory;

  before(async () => {
    const [tokenRegistry, exchange] = await Promise.all([
      TokenRegistry.deployed(),
      Exchange.deployed(),
    ]);
    exWrapper = new ExchangeWrapper(exchange);
    const [repAddress, dgdAddress] = await Promise.all([
      tokenRegistry.getTokenAddressBySymbol('REP'),
      tokenRegistry.getTokenAddressBySymbol('DGD'),
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
  });

  beforeEach(async () => {
    order = await orderFactory.newSignedOrderAsync();
  });

  describe('getOrderHash', () => {
    it('should output the correct orderHash', async () => {
      const orderHashHex = await exWrapper.getOrderHashAsync(order);
      expect(order.params.orderHashHex).to.be.equal(orderHashHex);
    });
  });

  describe('isValidSignature', () => {
    beforeEach(async () => {
      order = await orderFactory.newSignedOrderAsync();
    });

    it('should return true with a valid signature', async () => {
      const success = await exWrapper.isValidSignatureAsync(order);
      const isValidSignature = order.isValidSignature();
      expect(isValidSignature).to.be.true();
      expect(success).to.be.true();
    });

    it('should return false with an invalid signature', async () => {
      order.params.r = chxUtil.bufferToHex(chxUtil.sha256('invalidR'));
      order.params.s = chxUtil.bufferToHex(chxUtil.sha256('invalidS'));
      const success = await exWrapper.isValidSignatureAsync(order);
      expect(order.isValidSignature()).to.be.false();
      expect(success).to.be.false();
    });
  });
});

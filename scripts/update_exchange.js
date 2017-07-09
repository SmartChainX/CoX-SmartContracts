const fs = require('fs');
const _ = require('lodash');
const solc = require('solc');
const Web3 = require('web3');
const sha3 = require('crypto-js/sha3');
const promisify = require('es6-promisify');

(async () => {
  const KOVAN_NETWORK_ID = 42;
  const JSON_RPC_PORT = 8545;
  const NODE_URL = `http://localhost:${JSON_RPC_PORT}`;
  const ARTIFACTS_DIR = `${__dirname}/../build/contracts`;
  const CONTRACTS_DIR = `${__dirname}/../contracts`;

  const proxyArtifact = require(`${ARTIFACTS_DIR}/Proxy`);
  const tokenRegistryArtifact = require(`${ARTIFACTS_DIR}/TokenRegistry`);
  const exchangeArtifact = require(`${ARTIFACTS_DIR}/Exchange`);

  const getContractContents = path => {
    const contents = fs.readFileSync(`${CONTRACTS_DIR}/${path}`).toString();
    return {contents};
  };

  const getAddressFromArtifactOrThrow = artifact => {
    try {
      address = artifact.networks[KOVAN_NETWORK_ID].address;
      return address;
    } catch (err) {
      throw new Error(`${artifact.contract_name} not deployed on network ${KOVAN_NETWORK_ID}`);
    }
  }

  const exchangeContents = getContractContents('Exchange.sol').contents;
  const inputs = {'Exchange.sol': exchangeContents};
  const activateOptimiserFlag = 1;
  const compiledExchange = solc.compile({sources: inputs}, activateOptimiserFlag, getContractContents);

  const exchangeContractReference = 'Exchange.sol:Exchange';
  const exchangeABI = JSON.parse(compiledExchange.contracts[exchangeContractReference].interface);
  const exchangeBytecode = `0x${compiledExchange.contracts[exchangeContractReference].bytecode}`;
  const tokenRegistryABI = tokenRegistryArtifact.abi;

  const proxyKovanAddress = getAddressFromArtifactOrThrow(proxyArtifact);
  const tokenRegistryKovanAddress = getAddressFromArtifactOrThrow(tokenRegistryArtifact);

  const web3 = new Web3(new Web3.providers.HttpProvider(NODE_URL));
  const tokenRegistryContract = web3.chx.contract(tokenRegistryABI);
  const tokenRegistryInstance = tokenRegistryContract.at(tokenRegistryKovanAddress);

  const accounts = await promisify(web3.chx.getAccounts)();
  const owner = accounts[0];
  const zrxTokenAddress = await promisify(tokenRegistryInstance.getTokenAddressBySymbol)('ZRX');
  const exchangeContract = web3.chx.contract(exchangeABI);
  const gasEstimate = web3.chx.estimateGas({data: exchangeBytecode});
  const additionalGas = 500000;
  exchangeContract.new(zrxTokenAddress, proxyKovanAddress, {
    data: exchangeBytecode,
    from: owner,
    gas: gasEstimate + additionalGas,
  }, async (err, exchangeContractInstance) => {
    if (err && _.isUndefined(exchangeContractInstance)) {
      console.log(`Error encountered: ${err}`);
    } else if (_.isUndefined(exchangeContractInstance.address)) {
      console.log(`transactionHash: ${exchangeContractInstance.transactionHash}`);
    } else {
      console.log(`Exchange address: ${exchangeContractInstance.address}`);

      const newExchangeArtifact = _.assign({}, exchangeArtifact);
      newExchangeArtifact.abi = exchangeABI;
      newExchangeArtifact.unlinked_binary = exchangeBytecode;
      const kovanSpecificExchangeArtifact = newExchangeArtifact.networks[KOVAN_NETWORK_ID];
      kovanSpecificExchangeArtifact.address = exchangeContractInstance.address;
      kovanSpecificExchangeArtifact.updated_at = new Date().getTime();
      const kovanNetworkEvents = _.keys(kovanSpecificExchangeArtifact.events);
      _.each(kovanNetworkEvents, event => {
        delete kovanSpecificExchangeArtifact.events[event];
      });
      _.each(exchangeABI, item => {
        if (item.type === 'event') {
          const paramTypes = _.map(item.inputs, param => param.type);
          const signature = `${item.name}(${paramTypes.join(',')})`;
          const outputLength = 256;
          kovanSpecificExchangeArtifact.events[`0x${sha3(signature, {outputLength})}`] = item;
        }
      });

      await promisify(fs.writeFile)(`${ARTIFACTS_DIR}/Exchange.json`, JSON.stringify(newExchangeArtifact));
      console.log('Exchange artifact updated!');
    }
  });
})();

### CoX-SmartContracts
CoX is an open protocol that facilitates trustless, low friction exchange of ChainX-based assets. A full description of the protocol may be found in our whitepaper. This repository contains the system of Ethereum smart contracts comprising CoX protocol's shared on-chain settlement layer, native token (CHX) and decentralized governance structure. 

### Descriptions
Exchange contains all business logic associated with executing trades and cancelling orders. Exchange accepts orders that conform to CoX message format, allowing for off-chain order relay with on-chain settlement. Exchange is designed to be replaced as protocol improvements are adopted over time. It follows that Exchange does not have direct access to CHX256 token allowances; instead, all transfers are carried out by Proxy on behalf of Exchange.

### Running Tests

Start Testrpc

```
npm run testrpc
```

Compile contracts

```
npm run compile
```

Run tests

```
npm run test
```

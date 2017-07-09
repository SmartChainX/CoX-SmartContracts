export class Artifacts {
  public Migrations: any;
  public Proxy: any;
  public TokenRegistry: any;
  public MultiSigWalletWithTimeLock: any;
  public Exchange: any;
  public ZRXToken: any;
  public DummyToken: any;
  public ChainXToken: any;
  public TokenDistributionWithRegistry: any;
  public MultiSigWalletWithTimeLockExceptRemoveAuthorizedAddress: any;
  constructor(artifacts: any) {
    this.Migrations = artifacts.require('Migrations');
    this.Proxy = artifacts.require('Proxy');
    this.TokenRegistry = artifacts.require('TokenRegistry');
    this.MultiSigWalletWithTimeLock = artifacts.require('MultiSigWalletWithTimeLock');
    this.Exchange = artifacts.require('Exchange');
    this.ZRXToken = artifacts.require('ZRXToken');
    this.DummyToken = artifacts.require('DummyToken');
    this.ChainXToken = artifacts.require('ChainXToken');
    this.TokenDistributionWithRegistry = artifacts.require('TokenDistributionWithRegistry');
    this.MultiSigWalletWithTimeLockExceptRemoveAuthorizedAddress = artifacts.require('MultiSigWalletWithTimeLockExceptRemoveAuthorizedAddress');
  }
}

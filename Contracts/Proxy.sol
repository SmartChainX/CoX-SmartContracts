*/
pragma solidity ^0.4.11;

import "./base/Token.sol";
import "./base/Ownable.sol";
 require(authorized[msg.sender]);
        _;
    }

    modifier targetAuthorized(address target) {
        require(authorized[target]);
        _;
    }

    modifier targetNotAuthorized(address target) {
        require(!authorized[target]);
        _;
    }

    mapping (address => bool) public authorized;
    address[] public authorities;

    event LogAuthorizedAddressAdded(address indexed target, address indexed caller);
    event LogAuthorizedAddressRemoved(address indexed target, address indexed caller);

    /*
     * Public functions
     */

    /// @dev Authorizes an address.
    /// @param target Address to authorize.
    /// @return Success of authorization.
    function addAuthorizedAddress(address target)
        onlyOwner
        targetNotAuthorized(target)
        returns (bool success)
    {
        authorized[target] = true;
        authorities.push(target);
        LogAuthorizedAddressAdded(target, msg.sender);
        return true;
    }

    /// @dev Removes authorizion of an address.
    /// @param target Address to remove authorization from.
    /// @return Success of deauthorization.
    function removeAuthorizedAddress(address target)
        onlyOwner
        targetAuthorized(target)
        returns (bool success)
    {
        delete authorized[target];
        for (uint i = 0; i < authorities.length; i++) {
            if (authorities[i] == target) {
                authorities[i] = authorities[authorities.length - 1];
                authorities.length -= 1;
                break;
            }
        }
        LogAuthorizedAddressRemoved(target, msg.sender);
        return true;
    }

   
    /// @param token Address of token to transfer.
    /// @param from Address to transfer token from.
    /// @param to Address to transfer token to.
    /// @param value Amount of token to transfer.
    /// @return Success of transfer.
    function transferFrom(
        address token,
        address from,
        address to,
        uint value)
        onlyAuthorized
        returns (bool success)
    {
        return Token(token).transferFrom(from, to, value);
    }

    /*
     * Public constant functions
     */

    /// @dev Gets all authorized addresses.
    /// @return Array of authorized addresses.
    function getAuthorizedAddresses()
        constant
        returns (address[])
    {
        return authorities;
    }
}

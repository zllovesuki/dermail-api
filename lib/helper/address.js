var Promise = require('bluebird'),
	shortid = require('shortid');

shortid.worker(process.pid % 16);

var self = module.exports = {
	createAlias: Promise.method(function(r, one, aliasOf, accountId, owner) {
		var email = one.address || '';
		var friendlyName = one.name;
		var account = email.substring(0, email.lastIndexOf("@")).toLowerCase();
		var domain = email.substring(email.lastIndexOf("@") +1).toLowerCase();
		var id = shortid.generate();
		return r
		.table('addresses')
		.insert({
			addressId: id,
			account: account,
			domain: domain,
			accountId: accountId,
			friendlyName: friendlyName,
			internalOwner: owner,
			aliasOf: aliasOf
		})
		.run(r.conn)
		.then(function() {
			return id;
		})
	}),
	getAddress: Promise.method(function(r, email, accountId, emptyResponse) {
		var empty = emptyResponse || {};
		email = email || '';
		var account = email.substring(0, email.lastIndexOf("@")).toLowerCase();
		var domain = email.substring(email.lastIndexOf("@") +1).toLowerCase();
		return r
		.table('addresses', {readMode: 'majority'})
		.getAll([account, domain, accountId], {index: 'accountDomainAccountId'})
		.pluck('addressId', 'friendlyName', 'aliasOf')
		.slice(0, 1)
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(result) {
			if (result.length === 0) {
				return empty;
			}else{
				var address = result[0];
				/*if (typeof address.aliasOf !== 'undefined' && address.aliasOf !== null) {
					// The address is an alias of another address
					return r
					.table('addresses', {readMode: 'majority'})
					.get(address.aliasOf)
					.pluck('addressId', 'friendlyName')
					.run(r.conn)
				}
				delete address.aliasOf;*/
				return address;
			}
		})
	}),
	getOrCreateAddress: Promise.method(function(r, one, accountId) {
		var email = one.address || '';
		var friendlyName = one.name;
		var account = email.substring(0, email.lastIndexOf("@")).toLowerCase();
		var domain = email.substring(email.lastIndexOf("@") +1).toLowerCase();
		return r
		.table('addresses', {readMode: 'majority'})
		.getAll([account, domain, accountId], {index: 'accountDomainAccountId'})
		.pluck('addressId', 'internalOwner', 'aliasOf')
		.slice(0, 1)
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(result) {
			if (result.length === 0) {
				// Address does not exist, let's create one
				// Alias should be created when adding account/domain, and **will not** be deleted once it is created
				// (Since they are unique to one account)
				var id = shortid.generate();
				return r
				.table('addresses')
				.insert({
					addressId: id,
					account: account,
					domain: domain,
					accountId: accountId,
					friendlyName: friendlyName,
					internalOwner: null
				})
				.run(r.conn)
				.then(function() {
					return id;
				})
			}else{
				var address = result[0];
				/*if (typeof address.aliasOf !== 'undefined' && address.aliasOf !== null) {
					return address.aliasOf;
				}*/
				var addressId = address.addressId;
				// Internal defined address, do not update displayName
				if (address.internalOwner !== null) return addressId;
				// Otherwise, let's update the friendlyName
				return r
				.table('addresses', {readMode: 'majority'})
				.get(addressId)
				.update({
					friendlyName: friendlyName
				})
				.run(r.conn)
				.then(function() {
					return addressId;
				})
			}
		})
	}),
	getArrayOfFromAddress: Promise.method(function(r, accountId, fromAddresses) {
		// Perspective is relative. "From" in the eyes of RX, "To" in the eyes of TX
		var arrayOfFromAddress = [];
		return Promise.map(fromAddresses, function(one) {
			if (!one) return;
			return self
			.getOrCreateAddress(r, one, accountId)
			.then(function(addressId) {
				arrayOfFromAddress.push(addressId);
				return;
			})
		}, { concurrency: 3 })
		.then(function() {
			return arrayOfFromAddress;
		})
	}),
	getArrayOfToAddress: Promise.method(function(r, accountId, myAddress, toAddresses) {
		// Perspective is relative. "To" in the eyes of RX, "From" in the eyes of TX
		var arrayOfToAddress = [];
		return Promise.map(toAddresses, function(one) {
			if (!one) return;
			return self
			.getOrCreateAddress(r, one, accountId)
			.then(function(addressId) {
				arrayOfToAddress.push(addressId);
				return;
			})
		}, { concurrency: 3 })
		.then(function() {
			return self
			.getAddress(r, myAddress, accountId)
			.then(function(addressObject) {
				var addressId = addressObject.addressId;
				arrayOfToAddress.push(addressId);
				return;
			})
		})
		.then(function() {
			return arrayOfToAddress;
		})
	})
}

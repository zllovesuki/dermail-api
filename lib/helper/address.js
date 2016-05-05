var Promise = require('bluebird');

var self = module.exports = {
	getAddress: Promise.method(function(r, email, accountId, emptyResponse) {
		var empty = emptyResponse || {};
		email = email || '';
		var account = email.substring(0, email.lastIndexOf("@")).toLowerCase();
		var domain = email.substring(email.lastIndexOf("@") +1).toLowerCase();
		return r
		.table('addresses')
		.getAll([account, domain, accountId], {index: 'accountDomainAccountId'})
		.pluck('addressId', 'friendlyName')
		.slice(0, 1)
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(result) {
			if (result.length === 0) {
				return empty;
			}else{
				return result[0];
			}
		})
	}),
	getOrCreateAddress: Promise.method(function(r, one, accountId) {
		var email = one.address || '';
		var friendlyName = one.name;
		var account = email.substring(0, email.lastIndexOf("@")).toLowerCase();
		var domain = email.substring(email.lastIndexOf("@") +1).toLowerCase();
		return r
		.table('addresses')
		.getAll([account, domain, accountId], {index: 'accountDomainAccountId'})
		.pluck('addressId', 'internalOwner')
		.slice(0, 1)
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(result) {
			if (result.length === 0) {
				// Address does not exist, let's create one
				return r
				.table('addresses')
				.insert({
					account: account,
					domain: domain,
					accountId: accountId,
					friendlyName: friendlyName,
					internalOwner: null
				})
				.getField('generated_keys')
				.do(function (keys) {
					return keys(0);
				})
				.run(r.conn)
				.then(function(addressId) {
					return addressId;
				})
			}else{
				var addressId = result[0]['addressId'];
				// Internal defined address, do not update displayName
				if (result[0]['internalOwner'] !== null) return addressId;
				// Otherwise, let's update the friendlyName
				return r
				.table('addresses')
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

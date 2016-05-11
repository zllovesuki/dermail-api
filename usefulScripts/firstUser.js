var config = require('../config.js');
var r = require('rethinkdb');

r.connect(config.rethinkdb, function(err, conn) {
	actual(conn);
});

// Fill out your information below
var hash = ''; // This should be hashed with bcrypt, refers to the screenshot
var username = "JohnDoe";
var account = 'me';
var domain = 'domain.com'
var fN = 'John';
var lN = 'Doe';

function actual(conn) {
	r
	.table('users')
	.insert({
		username: username,
		password: hash,
		firstName: fN,
		lastName: lN
	})
	.getField('generated_keys')
	.do(function(keys) {
		return keys(0);
	})
	.run(conn)
	.then(function(userId) {
		r
		.table('domains')
		.insert({
			userId: userId,
			domain: domain,
			alias: []
		})
		.getField('generated_keys')
		.do(function(keys) {
			return keys(0);
		})
		.run(conn)
		.then(function(domainId) {
			r
			.table('accounts')
			.insert({
				userId: userId,
				domainId: domainId,
				account: account
			})
			.getField('generated_keys')
			.do(function(keys) {
				return keys(0);
			})
			.run(conn)
			.then(function(accountId) {
				r
				.table('folders')
				.insert({
					accountId: accountId,
					parent: null,
					displayName: 'Inbox',
					description: 'Main Inbox',
					mutable: false
				})
				.getField('generated_keys')
				.do(function(keys) {
					return keys(0);
				})
				.run(conn)
				.then(function(folderId) {
					r
					.table('addresses')
					.insert({
						account: account,
						domain: domain,
						friendlyName: fN + ' ' + lN,
						internalOwner: userId
					})
					.getField('generated_keys')
					.do(function(keys) {
						return keys(0);
					})
					.run(conn)
					.then(function(addressId) {
						console.log('Account ID: ' + accountId);
						console.log('User ID: ' + userId);
						console.log('Domain ID: ' + domainId);
						console.log('Folder ID: ' + folderId);
						console.log('Address ID: ' + addressId);
						conn.close();
					});
				})
			})
		})
	})
}

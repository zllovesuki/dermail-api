var config = require('../config.js');
var r = require('rethinkdb');
var shortid = require('shortid');

shortid.worker(process.pid % 16);

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

var userId = shortid.generate();
var domainId = shortid.generate();
var accountId = shortid.generate();
var folderId = shortid.generate();
var addressId = shortid.generate();

function actual(conn) {
	return r
	.table('users')
	.insert({
		userId: userId,
		username: username,
		password: hash,
		firstName: fN,
		lastName: lN
	})
	.run(conn)
	.then(function() {
		return r
		.table('domains')
		.insert({
			domainId: domainId,
			userId: userId,
			domain: domain,
            domainAdmin: userId,
			alias: []
		})
		.run(conn)
	})
	.then(function() {
		return r
		.table('accounts')
		.insert({
			accountId: accountId,
			userId: userId,
			domainId: domainId,
			account: account
		})
		.run(conn)
	})
	.then(function() {
		return r
		.table('folders')
		.insert({
			folderId: folderId,
			accountId: accountId,
			parent: null,
			displayName: 'Inbox',
			description: 'Main Inbox',
			mutable: false
		})
		.run(conn)
	})
	.then(function() {
		return r
		.table('addresses')
		.insert({
			addressId: addressId,
            accountId: accountId,
			account: account,
			domain: domain,
			friendlyName: fN + ' ' + lN,
			internalOwner: userId
		})
		.run(conn)
	})
	.then(function() {
		console.log('Account ID: ' + accountId);
		console.log('User ID: ' + userId);
		console.log('Domain ID: ' + domainId);
		console.log('Folder ID: ' + folderId);
		console.log('Address ID: ' + addressId);
		conn.close();
	});
}

var express = require('express'),
	router = express.Router(),
	_ = require('lodash'),
	common = require('dermail-common'),
	helper = require('../lib/helper'),
	Promise = require('bluebird');

router.post('/get-s3', function(req, res, next) {
	res.setHeader('Content-Type', 'application/json');

	var config = req.config;

	var remoteSecret = req.body.remoteSecret || null;

	if (remoteSecret !== config.remoteSecret) {
		return res.status(200).send({ok: false});
	}

	return res.status(200).send({ok: true, data: config.s3});
})

router.post('/check-recipient', function(req, res, next) {
	res.setHeader('Content-Type', 'application/json');

	var config = req.config;

	var remoteSecret = req.body.remoteSecret || null;

	if (remoteSecret !== config.remoteSecret) {
		return res.status(200).send({ok: false});
	}

	var r = req.r;

	var email = req.body.to || null;
	if (email === null) {
		return res.status(200).send({ok: false});
	}
	var account = email.substring(0, email.lastIndexOf("@")).toLowerCase();
	var domain = email.substring(email.lastIndexOf("@") +1).toLowerCase();

	return checkDomain(r, domain).then(function(domainResult) {
		return checkAccount(r, account, domainResult.domainId).then(function(accountResult) {
			return res.status(200).send({ok: true});
		})
	})
	.catch(function(e) {
		return res.status(200).send({ok: false});
	})
});

router.post('/store', function(req, res, next) {
	res.setHeader('Content-Type', 'application/json');

	var config = req.config;

	var remoteSecret = req.body.remoteSecret || null;

	if (remoteSecret !== config.remoteSecret) {
		return res.status(200).send({ok: false, error: 'Invalid remoteSecret.'});
	}

	delete req.body.remoteSecret;

	var r = req.r;

	var message = req.body;

	var envelopeTo = message.envelopeTo[0];
	var recipient = null;
	if (typeof envelopeTo !== 'undefined') {
		if (envelopeTo.hasOwnProperty('address')) {
			recipient = envelopeTo.address.toLowerCase();
		}
	}

	if (recipient === null) {
		return res.send({ok: false, error: 'No envelopeTo.'});
	}

	// Delete ourselves
	for (key in message.to) {
		if (message.to[key].address == recipient) {
			delete message.to[key];
		}
	}

	var recipientAccount = recipient.substring(0, recipient.lastIndexOf("@")).toLowerCase();
	var recipientDomain = recipient.substring(recipient.lastIndexOf("@") +1).toLowerCase();

	return checkDomain(r, recipientDomain).then(function(domainResult) {
		var domainId = domainResult.domainId;
		return checkAccount(r, recipientAccount, domainId).then(function(accountResult) {
			// Now account and domain are correct, let's:
			// 1. Assign "from" address in the database
			// 2. Get our addressId
			// 3. Assign "to" address in the database
			// 4. Put the message into the correct folder
			// 5. Save the attachments
			// 6. Save the headers
			// 7. Send new mail notification

			var accountId = accountResult.accountId;
			var userId = accountResult.userId;
			// we need to normalize alias to "canonical" one
			var myAddress = accountResult.account + '@' + domainResult.domain;
			//var myAddress = recipient;

			return Promise.join(
				getArrayOfToAddress(r, accountId, myAddress, message.to),
				getArrayOfFromAddress(r, accountId, message.from),
				function(arrayOfToAddress, arrayOfFromAddress) {
					return saveMessage(r, accountId, arrayOfToAddress, arrayOfFromAddress, message)
				}
			)
			.then(function(messageId) {
				return filter(r, accountId, messageId);
			})
			.then(function(notify) {
				if (notify) {
					return common.sendNewMailNotification(r, userId, accountId, 'New mail at: ' + recipient)
				}
			})
			.then(function() {
				return res.send({ok: true});
			});
		})
	})
	.catch(function(e) {
		console.dir(e);
		return res.send({ok: false, error: e});
	})
});

var checkDomain = Promise.method(function (r, domain) {
	return r
	.table('domains')
	.getAll(domain, {index: 'domain'})
	.slice(0, 1)
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	}).then(function(result) {
		if (result.length === 0) {
			// Maybe it is one of the alias?
			return r
			.table('domains')
			.getAll(domain, {index: 'alias'})
			.slice(0, 1)
			.run(r.conn)
			.then(function(cursor) {
				return cursor.toArray();
			}).then(function(result) {
				if (result.length === 0) {
					throw new Error('Domain does not exist: ' + domain);
				}else{
					return result[0];
				}
			});
		}else{
			return result[0];
		}
	})
})

var checkAccount = Promise.method(function (r, account, domainId) {
	return r
	.table('accounts')
	.getAll([account, domainId], {index: 'accountDomainId'})
	.slice(0, 1)
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	}).then(function(result) {
		if (result.length === 0) {
			throw new Error('Account does not exist: ' + account);
		}else{
			return result[0];
		}
	})
})

var getArrayOfFromAddress = function (r, accountId, fromAddresses) {
	return new Promise(function(resolve, reject) {
		var arrayOfFromAddress = [];

		return Promise.map(fromAddresses, function(one) {
			if (!one) return;
			return common
			.getOrCreateAddress(r, one, accountId)
			.then(function(addressId) {
				arrayOfFromAddress.push(addressId);
				return;
			})
		})
		.then(function() {
			return resolve(arrayOfFromAddress);
		})
		.catch(function(e) {
			return reject(e);
		})
	})
}

var getArrayOfToAddress = function (r, accountId, myAddress, toAddresses) {
	return new Promise(function(resolve, reject) {
		var arrayOfToAddress = [];

		return Promise.map(toAddresses, function(one) {
			if (!one) return;
			return common
			.getOrCreateAddress(r, one, accountId)
			.then(function(addressId) {
				arrayOfToAddress.push(addressId);
				return;
			})
		})
		.then(function() {
			return common
			.getAddress(r, myAddress, accountId)
			.then(function(addressObject) {
				var addressId = addressObject.addressId;
				arrayOfToAddress.push(addressId);
				return;
			})
		})
		.then(function() {
			return resolve(arrayOfToAddress);
		})
		.catch(function(e) {
			return reject(throwError('array of to', e));
		})
	})
}

var filter = function (r, accountId, messageId) {
	var notify = true;
	return new Promise(function(resolve, reject) {
		return r
		.table('filters')
		.getAll(accountId, { index: 'accountId' })
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(filters) {
			if (filters.length === 0) return; // Early surrender if account has no filters
			return r
			.table('messages')
			.get(messageId)
			.merge(function(doc) {
				return {
					'to': doc('to').concatMap(function(to) { // It's like a subquery
						return [r.table('addresses').get(to).without('accountId', 'addressId', 'internalOwner')]
					}),
					'from': doc('from').concatMap(function(from) { // It's like a subquery
						return [r.table('addresses').get(from).without('accountId', 'addressId', 'internalOwner')]
					})
				}
			})
			.pluck('from', 'to', 'subject', 'text', 'messageId', 'accountId')
			.run(r.conn)
			.then(function(message) {
				var results = [message];
				return Promise.map(filters, function(filter) {
					var criteria = filter.pre;
					return common
					.applyFilters(results, criteria.from, criteria.to, criteria.subject, criteria.contain, criteria.exclude)
					.then(function(filtered) {
						// It will always be a length of 1
						if (filtered.length === 1) {
							return Promise.map(Object.keys(filter.post), function(key) {
								if (key === 'doNotNotify') {
									notify = !filter.post.doNotNotify;
								}else{
									return common.applyAction(r, key, filter.post[key], message);
								}
							})
						}
					})
				});
			})
		})
		.then(function() {
			return resolve(notify);
		})
		.catch(function(e) {
			return reject(e);
		})
	});
}

var saveMessage = function (r, accountId, arrayOfToAddress, arrayOfFromAddress, message) {
	return new Promise(function(resolve, reject) {
		return common
		.getInternalFolder(r, accountId, 'Inbox')
		.then(function(inboxFolder) {
			var headers = _.cloneDeep(message.headers);
			delete message.headers;
			var attachments = _.cloneDeep(message.attachments);
			delete message.attachments;

			message.from = arrayOfFromAddress;
			message.to = arrayOfToAddress;

			// Assign folder
			message.folderId = inboxFolder;
			// Assign account
			//message.userId = accountResult.userId;
			message.accountId = accountId;
			// Default value
			message.isRead = false;
			message.isStar = false;

			//delete default messageId, if it has one
			if (message.hasOwnProperty('messageId')) {
				message._messageId = _.clone(message.messageId);
				delete message.messageId;
			}

			return Promise.join(
				helper.saveHeaders(r, headers),
				helper.saveAttachments(r, attachments),
				function(headerId, arrayOfAttachments) {
					message.headers = headerId;
					message.attachments = arrayOfAttachments;
					return common.saveMessage(r, message)
				}
			)
		})
		.then(function(messageId) {
			return resolve(messageId);
		})
		.catch(function(e) {
			return reject(throwError('save message', e));
		})
	})
}

function throwError(where, err) {
	var error = {};
	error.where = where;
	error.error = err;
	return error;
}

module.exports = router;

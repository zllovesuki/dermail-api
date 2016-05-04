var Promise = require('bluebird'),
	push = require('web-push'),
	crypto = require('crypto'),
	_ = require('lodash'),
	common = require('dermail-common'),
	config = require('../config.js');

var self = module.exports = {
	userAccountMapping: Promise.method(function(r, userId, accountId) {
		return r
		.table('accounts')
		.getAll([userId, accountId], {index: 'userAccountMapping'})
		.eqJoin('domainId', r.table('domains'))
		.zip()
		.pluck('accountId', 'account', 'domain')
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(account) {
			return account[0];
		})
	}),
	accountFolderMapping: Promise.method(function(r, accountId, folderId) {
		return r
		.table('folders')
		.getAll([accountId, folderId], {index: 'accountFolderMapping'})
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(result) {
			if (result.length === 0) {
				throw new Error('Folder does not belong to account.');
			}else{
				return result[0];
			}
		})
	}),
	messageAccountMapping: Promise.method(function(r, messageId, accountId) {
		return r
		.table('messages')
		.getAll([messageId, accountId], {index: 'messageAccountMapping'})
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(result) {
			if (result.length === 0) {
				throw new Error('Message does not belong to account.');
			}else{
				return result[0];
			}
		})
	}),
	sendNotification: Promise.method(function(r, payload, subscription) {

		push.setGCMAPIKey(config.gcm_api_key);

		var params = {};

		var notify = function(ep, pa) {
			push.sendNotification(ep, pa);
		}

		if (typeof subscription.keys !== 'undefined') {
			params = {
				userPublicKey: subscription.keys.p256dh,
				userAuth: subscription.keys.auth,
				payload: JSON.stringify(payload)
			};
			return notify(subscription.endpoint, params);
		}else {
			var hash = crypto.createHash('sha1').update(subscription.endpoint).digest("hex");

			return r
			.table('payload')
			.insert({
				endpoint: hash,
				payload: payload
			})
			.run(r.conn)
			.then(function() {
				return notify(subscription.endpoint, params);
			})
		}
	}),
	saveAttachments: function(r, attachments) {
		return new Promise(function(resolve, reject) {
			var arrayOfAttachments = [];
			return Promise.map(attachments, function(attachment) {
				if (typeof attachment.content !== 'undefined') {
					delete attachment.content; // We don't want to store the content in the database
				}
				if (typeof attachment.stream !== 'undefined') {
					delete attachment.stream; // We don't want to store unreadable stream
				}
				return common
				.saveAttachment(r, attachment)
				.then(function(attachmentId) {
					return arrayOfAttachments.push(attachmentId);
				})
			})
			.then(function() {
				return resolve(arrayOfAttachments);
			})
			.catch(function(e) {
				return reject(e);
			})
		})
	},
	saveHeaders: function(r, headers) {
		return new Promise(function(resolve, reject) {
			return common
			.saveHeaders(r, headers)
			.then(function(headerId) {
				return resolve(headerId);
			})
			.catch(function(e) {
				return reject(e);
			})
		})
	},
	saveMessage: function (r, accountId, folderId, arrayOfToAddress, arrayOfFromAddress, message, isRead) {
		return new Promise(function(resolve, reject) {
			var headers = _.cloneDeep(message.headers);
			delete message.headers;
			var attachments = _.cloneDeep(message.attachments);
			delete message.attachments;

			message.from = arrayOfFromAddress;
			message.to = arrayOfToAddress;

			// Assign folder
			message.folderId = folderId;
			// Assign account
			//message.userId = accountResult.userId;
			message.accountId = accountId;
			// Default value
			message.isRead = isRead || false;
			message.isStar = false;

			//delete default messageId, if it has one
			if (message.hasOwnProperty('messageId')) {
				message._messageId = _.clone(message.messageId);
				delete message.messageId;
			}

			return Promise.join(
				self.saveHeaders(r, headers),
				self.saveAttachments(r, attachments),
				function(headerId, arrayOfAttachments) {
					message.headers = headerId;
					message.attachments = arrayOfAttachments;
					return common.saveMessage(r, message)
				}
			)
			.then(function(messageId) {
				return resolve(messageId);
			})
			.catch(function(e) {
				return reject(e);
			})
		})
	},
	getArrayOfFromAddress: function (r, accountId, fromAddresses) {
		// Perspective is relative. "From" in the eyes of RX, "To" in the eyes of TX
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
	},
	getArrayOfToAddress: function (r, accountId, myAddress, toAddresses) {
		// Perspective is relative. "To" in the eyes of RX, "From" in the eyes of TX
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
}

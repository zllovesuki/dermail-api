var Promise = require('bluebird'),
	push = require('web-push'),
	crypto = require('crypto'),
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
	}
}

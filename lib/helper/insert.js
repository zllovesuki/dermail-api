var Promise = require('bluebird'),
	_ = require('lodash');

var self = module.exports = {
	insertMessage: Promise.method(function(r, message) {
		return r
		.table('messages')
		.insert(message)
		.getField('generated_keys')
		.do(function (keys) {
			return keys(0);
		})
		.run(r.conn)
		.then(function(messageId) {
			return messageId;
		})
	}),
	insertHeaders: Promise.method(function(r, headers) {
		return r
		.table('messageHeaders')
		.insert(headers)
		.getField('generated_keys')
		.do(function (keys) {
			return keys(0);
		})
		.run(r.conn)
		.then(function(headerId) {
			return headerId;
		})
	}),
	insertAttachment: Promise.method(function(r, attachment) {
		return r
		.table('attachments')
		.insert(attachment)
		.getField('generated_keys')
		.do(function (keys) {
			return keys(0);
		})
		.run(r.conn)
		.then(function(attachmentId) {
			return attachmentId;
		})
	}),
	saveAttachments: Promise.method(function(r, attachments) {
		var arrayOfAttachments = [];
		return Promise.map(attachments, function(attachment) {
			if (typeof attachment.content !== 'undefined') {
				delete attachment.content; // We don't want to store the content in the database
			}
			if (typeof attachment.stream !== 'undefined') {
				delete attachment.stream; // We don't want to store unreadable stream
			}
			return self
			.insertAttachment(r, attachment)
			.then(function(attachmentId) {
				return arrayOfAttachments.push(attachmentId);
			})
		}, { concurrency: 3 })
		.then(function() {
			return arrayOfAttachments;
		})
	}),
	saveHeaders: Promise.method(function(r, headers) {
		return self
		.insertHeaders(r, headers)
		.then(function(headerId) {
			return headerId;
		})
	}),
	saveMessage: Promise.method(function(r, accountId, folderId, arrayOfToAddress, arrayOfFromAddress, message, isRead) {
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
				return self.insertMessage(r, message)
			}
		)
		.then(function(messageId) {
			return messageId;
		})
	})
}

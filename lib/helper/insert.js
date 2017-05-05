var Promise = require('bluebird'),
	shortid = require('shortid');
	_ = require('lodash');

shortid.worker(process.pid % 16);

var self = module.exports = {
	insertMessage: Promise.method(function(r, message) {
		var id = shortid.generate();
		message.messageId = id;
		return r
		.table('messages')
		.insert(message)
		.run(r.conn)
		.then(function() {
			return id;
		})
	}),
	insertHeaders: Promise.method(function(r, headers) {
		var id = shortid.generate();
		headers.headerId = id;
		return r
		.table('messageHeaders')
		.insert(headers)
		.run(r.conn)
		.then(function() {
			return id;
		})
	}),
	insertAttachment: Promise.method(function(r, attachment) {
		var id = shortid.generate();
		attachment.attachmentId = id;
		return r
		.table('attachments')
		.insert(attachment)
		.run(r.conn)
		.then(function() {
			return id;
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
	saveMessage: Promise.method(function(r, accountId, folderId, message, isRead) {
		var _messageIdWasAdded = false;
		var headers = _.cloneDeep(message.headers);
		delete message.headers;
		var attachments = _.cloneDeep(message.attachments);
		delete message.attachments;

		message.to = message.to || [];
		message.from = message.from || [];
		message.cc = message.cc || [];
		message.bcc = messag.bcc || [];

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
			_messageIdWasAdded = true;
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
			if (_messageIdWasAdded === false) {
				return r
				.table('messages', { readMode: 'majority' })
				.get(messageId)
				.update({
					_messageId: messageId
				})
				.run(r.conn)
				.then(function() {
					return messageId;
				})
			}
			return messageId;
		})
	})
}

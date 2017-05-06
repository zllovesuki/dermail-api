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
	saveMessage: Promise.method(function(r, accountId, folderId, message, isRead) {
		var _messageIdWasAdded = false;

		message.attachments = message.attachments.map(function(attachment) {
            if (typeof attachment.content !== 'undefined') {
                delete attachment.content; // We don't want to store the content in the database
            }
            if (typeof attachment.stream !== 'undefined') {
                delete attachment.stream; // We don't want to store unreadable stream
            }
            return attachment
        });

		message.to = message.to || [];
		message.from = message.from || [];
		message.cc = message.cc || [];
		message.bcc = message.bcc || [];

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
        return self.insertMessage(r, message)
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

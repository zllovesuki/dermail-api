var Promise = require('bluebird'),
	push = require('web-push'),
	crypto = require('crypto'),
	_ = require('lodash'),
	AhoCorasick = require('aho-corasick');

var self = module.exports = {
	internalFolders: [
		{
			name: 'Inbox',
			description: 'Main Inbox'
		},
		{
			name: 'Trash',
			description: 'Trash Folder'
		},
		{
			name: 'Spam',
			description: 'Unsolicited'
		},
		{
			name: 'Sent',
			description: 'Sent Mails'
		}
	],
	getDescriptionOfInternalFolder: function(name) {
		return self.internalFolders.filter(function(v) {
			return v.name === name;
		})
	},
	getInternalFolder: Promise.method(function(r, accountId, name) {
		var search = self.getDescriptionOfInternalFolder(name);
		if (typeof search === 'undefined') {
			throw new Error('Not an internal folder.');
		}
		var description = search[0].description;
		return r
		.table('folders')
		.getAll([accountId, name], {index: 'accountIdInbox'}) // Check Account-Folder Mapping
		.pluck('folderId')
		.slice(0, 1)
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(folder) {
			if (folder.length === 0) { // No Folder, Let's create one
				return self
				.createFolder(r, accountId, name, description)
				.then(function(folderId) {
					return folderId;
				});
			}else{
				return folder[0]['folderId'];
			}
		})
	}),
	createFolder: Promise.method(function(r, accountId, name, description) {
		return r
		.table('folders')
		.insert({
			'accountId': accountId,
			'displayName': name,
			'description': description,
			'mutable': false,
			'parent': null
		})
		.getField('generated_keys')
		.do(function (keys) {
			return keys(0);
		})
		.run(r.conn)
		.then(function(folderId) {
			return folderId;
		})
	}),
	getAddress: Promise.method(function(r, email, accountId, emptyResponse) {
		var empty = emptyResponse || {};
		email = email.toLowerCase();
		var account = email.substring(0, email.lastIndexOf("@"));
		var domain = email.substring(email.lastIndexOf("@") +1);
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
		var email = one.address;
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
	sendNewMailNotification: Promise.method(function(r, userId, accountId, msg) {
		var insert = {};
		insert.userId = userId;
		insert.accountId = accountId;
		insert.type = 'new';
		insert.message = msg;
		return r
		.table('queue')
		.insert(insert)
		.getField('generated_keys')
		.do(function (keys) {
			return keys(0);
		})
		.run(r.conn)
		.then(function(queueId) {
			return queueId;
		})
	}),
	/*

	ApplyFilter expect 6 parameters, in which:

	results:
		an array of objects, which looks like:
	[{
		"from": [{
			"account": "me",
			"domain": "jerrychen.me",
			"friendlyName": "Jerry Chen"
		}],
		"subject": "hey this is a subject line!",
		"to": [{
			"account": "me",
			"domain": "rachelchen.me",
			"friendlyName": "Rachel Chen"
		}],
		"text": "hello world!"
	}]

	arrayOfFrom, arrayOfTo:
		an array of strings, which looks like:
		['me@jerrychen.me', 'is@3p.gd']

	subject, contain, exclude:
		an array of strings, which looks like:
		['me', 'you', 'photos', 'english']

	Each parameter can be null, that just means "does not check"

	Returns results that match the criterias

	*/
	applyFilters: Promise.method(function(results, arrayOfFrom, arrayOfTo, subject, contain, exclude) {

		var filtered = [];

		var modified = false;

		if (arrayOfFrom !== null) {
			for (var k = 0, len = arrayOfFrom.length; k < len; k++) {
				email = arrayOfFrom[k].toLowerCase();
				var account = email.substring(0, email.lastIndexOf("@"));
				var domain = email.substring(email.lastIndexOf("@") +1);
				for (var i = 0, rlen = results.length; i < rlen; i++) {
					var from = results[i].from;
					for (var j = 0, flen = from.length; j < flen; j++) {
						if ( ('*' === account || from[j].account == account) && from[j].domain == domain){
							filtered.push(results[i]);
							modified = true;
						}
					}
				}
			}
		}

		if (arrayOfTo !== null) {

			if (modified) {
				// credit default swap
				results = filtered;
				filtered = [];
			}

			for (var k = 0, len = arrayOfTo.length; k < len; k++) {
				email = arrayOfTo[k].toLowerCase();
				var account = email.substring(0, email.lastIndexOf("@"));
				var domain = email.substring(email.lastIndexOf("@") +1);
				for (var i = 0, rlen = results.length; i < rlen; i++) {
					var to = results[i].to;
					for (var j = 0, flen = to.length; j < flen; j++) {
						if ( ('*' === account || to[j].account == account) && to[j].domain == domain){
							filtered.push(results[i]);
							modified = true;
						}
					}
				}
			}
		}

		if (subject !== null) {

			if (modified) {
				// credit default swap
				results = filtered;
				filtered = [];
			}

			var subjectAC = new AhoCorasick();

			for (var k = 0, len = subject.length; k < len; k++) {
				var word;
				word = subject[k];
				subjectAC.add(word, {
					word: word
				});
			}

			subjectAC.build_fail();

			var actualSubject;

			for (var i = 0, rlen = results.length; i < rlen; i++) {

				actualSubject = {};

				subjectAC.search(results[i].subject.toLowerCase(), function(found_word) {
					if (actualSubject[found_word] == null) {
						actualSubject[found_word] = 0;
					}
					return actualSubject[found_word]++;
				});

				//if (containsAll(results[i].subject.toLowerCase(), subject)) {
				if (subject.length === Object.keys(actualSubject).length) {
					filtered.push(results[i]);
					modified = true;
				}
			}
		}

		if (contain !== null) {

			if (modified) {
				// credit default swap
				results = filtered;
				filtered = [];
			}

			var containAC = new AhoCorasick();

			for (var k = 0, len = contain.length; k < len; k++) {
				var word;
				word = contain[k];
				containAC.add(word, {
					word: word
				});
			}

			containAC.build_fail();

			var actualContain;

			for (var i = 0, rlen = results.length; i < rlen; i++) {

				actualContain = {};

				containAC.search(results[i].text.toLowerCase(), function(found_word) {
					if (actualContain[found_word] == null) {
						actualContain[found_word] = 0;
					}
					return actualContain[found_word]++;
				});

				//if (containsAll(results[i].contain.toLowerCase(), subject)) {
				if (contain.length === Object.keys(actualContain).length) {
					filtered.push(results[i]);
					modified = true;
				}
			}
		}

		if (exclude !== null) {

			if (modified) {
				// credit default swap
				results = filtered;
				filtered = [];
			}

			for (var i = 0, rlen = results.length; i < rlen; i++) {
				if (!self.containsAll(results[i].text.toLowerCase(), exclude)) {
					filtered.push(results[i]);
				}
			}
		}

		return filtered;
	}),
	applyAction: Promise.method(function(r, key, value, message) {
		switch (key) {
			case 'folder':
				return r
				.table('folders')
				.get(value)
				.run(r.conn)
				.then(function(folder) {
					if (folder === null) {
						// Maybe the folder was deleted by user, default back to Inbox
						return self
						.getInternalFolder(r, message.accountId, 'Inbox')
						.then(function(inboxId) {
							return inboxId;
						})
					}else{
						return folder['folderId'];
					}
				})
				.then(function(folderId) {
					return r
					.table('messages')
					.get(message.messageId)
					.update({
						folderId: folderId
					})
					.run(r.conn)
				})
				.catch(function(e) {
					throw e;
				})
			break;
			case 'markRead':
				return r
				.table('messages')
				.get(message.messageId)
				.update({
					isRead: value
				})
				.run(r.conn)
			break;
		}
	}),
	containsAll: function(haystack, needles){
		for (var i = 0; i < needles.length; i++){
			if (haystack.indexOf(needles[i]) === -1)
			return false;
		}
		return true;
	},
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
	sendNotification: Promise.method(function(r, gcm_api_key, payload, subscription) {

		push.setGCMAPIKey(gcm_api_key);

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
				return self
				.insertAttachment(r, attachment)
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
			return self
			.insertHeaders(r, headers)
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
					return self.insertMessage(r, message)
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
				return self
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
				return self
				.getOrCreateAddress(r, one, accountId)
				.then(function(addressId) {
					arrayOfToAddress.push(addressId);
					return;
				})
			})
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
				return resolve(arrayOfToAddress);
			})
			.catch(function(e) {
				return reject(throwError('array of to', e));
			})
		})
	}
}

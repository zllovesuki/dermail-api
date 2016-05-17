var config = require('../config.js');
var r = require('rethinkdb');
var shortid = require('shortid');
var Promise = require('bluebird');

shortid.worker(process.pid % 16);
shortid.seed(Math.floor(Math.random() * 10000) + 1)

r.connect(config.rethinkdb, function(err, conn) {
	r.conn = conn;
	changeAccountId()
	.then(changeFolderId)
	.then(changeUserId)
	.then(changeDomainId)
	.then(changeFilterId)
	.then(changeHeaderId)
	.then(changeAttachmentId)
	.then(changeMessageId)
	.then(changeAddressId)
	.then(clearTmp)
	.then(function() {
		r.conn.close();
	})
});

var changeAccountId = function() {
	console.log('changing accounts id');
	return r
	.table('accounts')
	.pluck('accountId')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray()
	})
	.then(function(rows) {
		return Promise.map(rows, function(row) {
			var oldAccountId = row.accountId;

			if (oldAccountId.length < 20) return;

			var newAccountId = shortid.generate();

			var updateAddresses = function(oldId, newId) {
				return r
				.table('addresses')
				.filter(function(doc) {
					return doc('accountId').eq(oldId);
				})
				.update({
					accountId: newId
				})
				.run(r.conn)
			};

			var updateFilters = function(oldId, newId) {
				return r
				.table('filters')
				.filter(function(doc) {
					return doc('accountId').eq(oldId);
				})
				.update({
					accountId: newId
				})
				.run(r.conn)
			};

			var updateFolders = function(oldId, newId) {
				return r
				.table('folders')
				.filter(function(doc) {
					return doc('accountId').eq(oldId);
				})
				.update({
					accountId: newId
				})
				.run(r.conn)
			};

			var updateMessages = function(oldId, newId) {
				return r
				.table('messages')
				.filter(function(doc) {
					return doc('accountId').eq(oldId);
				})
				.update({
					accountId: newId
				})
				.run(r.conn)
			};

			var updateAccount = function(oldId, newId) {
				return r
				.table('accounts')
				.get(oldId)
				.delete({ returnChanges: true })
				.run(r.conn)
				.then(function(change) {
					var result = change.changes[0].old_val;
					result.accountId = newId;
					return result;
				})
				.then(function(newAccount) {
					return r
					.table('accounts')
					.insert(newAccount)
					.run(r.conn)
				})
			};


			return updateAddresses(oldAccountId, newAccountId)
			.then(function() {
				return updateFilters(oldAccountId, newAccountId);
			})
			.then(function() {
				return updateFolders(oldAccountId, newAccountId);
			})
			.then(function() {
				return updateMessages(oldAccountId, newAccountId)
			})
			.then(function() {
				return updateAccount(oldAccountId, newAccountId)
			})
		}, { concurrency: 1 })
	})
	.then(function() {
		console.log('DONE: changing accounts id');
	})
}

var changeFolderId = function() {
	console.log('changing folders id');
	return r
	.table('folders')
	.pluck('folderId')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray()
	})
	.then(function(rows) {
		return Promise.map(rows, function(row) {
			var oldFolderId = row.folderId;

			if (oldFolderId.length < 20) return;

			var newFolderId = shortid.generate();

			var updateFilters = function(oldId, newId) {
				return r
				.table('filters')
				.filter(function(doc) {
					return doc('post')('folder').eq(oldId);
				})
				.update({
					post: {
						folder: newId
					}
				})
				.run(r.conn)
			};

			var updateMessages = function(oldId, newId) {
				return r
				.table('messages')
				.filter(function(doc) {
					return doc('folderId').eq(oldId);
				})
				.update({
					folderId: newId
				})
				.run(r.conn)
			};

			var updateFolder = function(oldId, newId) {
				return r
				.table('folders')
				.get(oldId)
				.delete({ returnChanges: true })
				.run(r.conn)
				.then(function(change) {
					var result = change.changes[0].old_val;
					result.folderId = newId;
					return result;
				})
				.then(function(newFolder) {
					return r
					.table('folders')
					.insert(newFolder)
					.run(r.conn)
				})
			};

			var updateParent = function(oldId, newId) {
				return r
				.table('folders')
				.filter(function(doc) {
					return doc('parent').eq(oldId);
				})
				.update({
					parent: newId
				})
				.run(r.conn)
			}

			return updateFilters(oldFolderId, newFolderId)
			.then(function() {
				return updateMessages(oldFolderId, newFolderId);
			})
			.then(function() {
				return updateParent(oldFolderId, newFolderId);
			})
			.then(function() {
				return updateFolder(oldFolderId, newFolderId);
			})
		}, { concurrency: 1 })
	})
	.then(function() {
		console.log('DONE: changing folders id');
	})
}

var changeMessageId = function() {
	console.log('changing messages id');
	return r
	.table('messages')
	.pluck('messageId')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray()
	})
	.then(function(rows) {
		return Promise.map(rows, function(row) {
			var oldMessageId = row.messageId;

			if (oldMessageId.length < 20) return;

			var newMessageId = shortid.generate();

			return r
			.table('messages')
			.get(oldMessageId)
			.delete({ returnChanges: true })
			.run(r.conn)
			.then(function(change) {
				var result = change.changes[0].old_val;
				result.messageId = newMessageId;
				return result;
			})
			.then(function(newMessage) {
				return r
				.table('messages')
				.insert(newMessage)
				.run(r.conn)
			})
		}, { concurrency: 1 })
	})
	.then(function() {
		console.log('DONE: changing messages id');
	})
}

var changeHeaderId = function() {
	console.log('changing headers id');
	return r
	.table('messages')
	.pluck('headers')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray()
	})
	.then(function(rows) {
		return Promise.map(rows, function(row) {
			var oldHeaderId = row.headers;

			if (oldHeaderId.length < 20) return;

			var newHeaderId = shortid.generate();

			var updateHeader = function(oldId, newId) {
				return r
				.table('messageHeaders')
				.get(oldId)
				.delete({ returnChanges: true })
				.run(r.conn)
				.then(function(change) {
					var result = change.changes[0].old_val;
					result.headerId = newId;
					return result;
				})
				.then(function(newHeader) {
					return r
					.table('messageHeaders')
					.insert(newHeader)
					.run(r.conn)
				})
			};

			var updateMessage = function(oldId, newId) {
				return r
				.table('messages')
				.filter(function(doc) {
					return doc('headers').eq(oldId);
				})
				.update({
					headers: newId
				})
				.run(r.conn)
			}

			return updateHeader(oldHeaderId, newHeaderId)
			.then(function() {
				return updateMessage(oldHeaderId, newHeaderId)
			})
		}, { concurrency: 1 })
	})
	.then(function() {
		console.log('DONE: changing headers id');
	})
}

var changeAttachmentId = function() {
	console.log('changing attachments id');
	return r
	.table('messages')
	.pluck('attachments', 'messageId')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray()
	})
	.then(function(rows) {
		return Promise.map(rows, function(row) {
			var newAttachmentIds = [];
			return Promise.map(row.attachments, function(oldAttachmentId) {

				if (oldAttachmentId.length < 20) return;

				var newAttachmentId = shortid.generate();
				newAttachmentIds.push(newAttachmentId);
				return r
				.table('attachments')
				.get(oldAttachmentId)
				.delete({ returnChanges: true })
				.run(r.conn)
				.then(function(change) {
					var result = change.changes[0].old_val;
					result.attachmentId = newAttachmentId;
					return result;
				})
				.then(function(newAttachment) {
					return r
					.table('attachments')
					.insert(newAttachment)
					.run(r.conn)
				})
			}, { concurrency: 1 })
			.then(function() {
				return r
				.table('messages')
				.get(row.messageId)
				.update({
					attachments: newAttachmentIds
				})
				.run(r.conn)
			})
		}, { concurrency: 1 })
	})
	.then(function() {
		console.log('DONE: changing attachments id');
	})
}

var changeFilterId = function() {
	console.log('changing filters id');
	return r
	.table('filters')
	.pluck('filterId')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray()
	})
	.then(function(rows) {
		return Promise.map(rows, function(row) {
			var oldFilterId = row.filterId;

			if (oldFilterId.length < 20) return;

			var newFilterId = shortid.generate();

			return r
			.table('filters')
			.get(oldFilterId)
			.delete({ returnChanges: true })
			.run(r.conn)
			.then(function(change) {
				var result = change.changes[0].old_val;
				result.filterId = newFilterId;
				return result;
			})
			.then(function(newFilter) {
				return r
				.table('filters')
				.insert(newFilter)
				.run(r.conn)
			})
		}, { concurrency: 1 })
	})
	.then(function() {
		console.log('DONE: changing filters id');
	})
}

var changeUserId = function() {
	console.log('changing users id');
	return r
	.table('users')
	.pluck('userId')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray()
	})
	.then(function(rows) {
		return Promise.map(rows, function(row) {
			var oldUserId = row.userId;

			if (oldUserId.length < 20) return;

			var newUserId = shortid.generate();

			var updateAccount = function(oldId, newId) {
				return r
				.table('accounts')
				.filter(function(doc) {
					return doc('userId').eq(oldId);
				})
				.update({
					userId: newId
				})
				.run(r.conn)
			}

			var updateUser = function(oldId, newId) {
				return r
				.table('users')
				.get(oldId)
				.delete({ returnChanges: true })
				.run(r.conn)
				.then(function(change) {
					var result = change.changes[0].old_val;
					result.userId = newId;
					return result;
				})
				.then(function(newUser) {
					return r
					.table('users')
					.insert(newUser)
					.run(r.conn)
				})
			}

			var updateDomain = function(oldId, newId) {
				return r
				.table('domains')
				.filter(function(doc) {
					return doc('domainAdmin').eq(oldId);
				})
				.update({
					domainAdmin: newId
				})
				.run(r.conn)
			}

			var updateSubscriptions = function(oldId, newId) {
				return r
				.table('pushSubscriptions')
				.get(oldId)
				.delete({ returnChanges: true })
				.run(r.conn)
				.then(function(change) {
					if (typeof change.changes[0] === 'undefined') return;
					var result = change.changes[0].old_val;
					result.userId = newId;
					return r
					.table('pushSubscriptions')
					.insert(result)
					.run(r.conn)
				})
			}

			return updateAccount(oldUserId, newUserId)
			.then(function() {
				return updateUser(oldUserId, newUserId);
			})
			.then(function() {
				return updateDomain(oldUserId, newUserId);
			})
			.then(fucntion() {
				return updateSubscriptions(oldUserId, newUserId)
			})
		}, { concurrency: 1 })
	})
	.then(function() {
		console.log('DONE: changing users id');
	})
}

var changeDomainId = function() {
	console.log('changing domains id');
	return r
	.table('domains')
	.pluck('domainId')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray()
	})
	.then(function(rows) {
		return Promise.map(rows, function(row) {
			var oldDomainId = row.domainId;

			if (oldDomainId.length < 20) return;

			var newDomainId = shortid.generate();

			var updateAccount = function(oldId, newId) {
				return r
				.table('accounts')
				.filter(function(doc) {
					return doc('domainId').eq(oldId);
				})
				.update({
					domainId: newId
				})
				.run(r.conn)
			}

			var updateDomain = function(oldId, newId) {
				return r
				.table('domains')
				.get(oldId)
				.delete({ returnChanges: true })
				.run(r.conn)
				.then(function(change) {
					var result = change.changes[0].old_val;
					result.domainId = newId;
					return result;
				})
				.then(function(newDomain) {
					return r
					.table('domains')
					.insert(newDomain)
					.run(r.conn)
				})
			}

			return updateAccount(oldDomainId, newDomainId)
			.then(function() {
				return updateDomain(oldDomainId, newDomainId)
			})

		}, { concurrency: 1 })
	})
	.then(function() {
		console.log('DONE: changing domains id');
	})
}

var changeAddressId = function() {
	console.log('changing addresses id');
	return r
	.table('addresses')
	.pluck('addressId')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray()
	})
	.then(function(rows) {
		return Promise.map(rows, function(row) {
			var oldAddressId = row.addressId;

			if (oldAddressId.length < 20) return;

			var newAddressId = shortid.generate();

			var updateMessage = function(oldId, newId) {
				return r
				.table('messages')
				.pluck('to', 'from', 'messageId')
				.filter(function(doc) {
					return doc('to').contains(oldId).or(doc('from').contains(oldId))
				})
				.run(r.conn)
				.then(function(cursor) {
					return cursor.toArray();
				})
				.then(function(results) {
					if (results.length === 0) return;
					return Promise.map(results, function(result) {

						var arrayOfTo = result.to;

						arrayOfTo = arrayOfTo.map(function(to) {
							return to == oldId ? newId : to;
						})

						var arrayOfFrom = result.from;

						arrayOfFrom = arrayOfFrom.map(function(from) {
							return from == oldId ? newId : from;
						})

						return r
						.table('messages')
						.get(result.messageId)
						.update({
							to: arrayOfTo,
							from: arrayOfFrom
						})
						.run(r.conn)
					}, { concurrency: 1 }) // No concurrency
				})
			}

			var updateAddress = function(oldId, newId) {
				return r
				.table('addresses')
				.get(oldId)
				.delete({ returnChanges: true })
				.run(r.conn)
				.then(function(change) {
					var result = change.changes[0].old_val;
					result.addressId = newId;
					return result;
				})
				.then(function(newAddress) {
					return r
					.table('addresses')
					.insert(newAddress)
					.run(r.conn)
				})
			}

			return updateMessage(oldAddressId, newAddressId)
			.then(function() {
				return updateAddress(oldAddressId, newAddressId);
			})
		}, { concurrency: 1 }) // No concurrency
	})
	.then(function() {
		console.log('DONE: changing addresses id');
	})
}

var clearTmp = function() {
	console.log('clearing queue and payload tables');
	return r
	.table('payload')
	.delete()
	.run(r.conn)
	.then(function() {
		return r
		.table('queue')
		.delete()
		.run(r.conn)
	})
}

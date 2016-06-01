var Promise = require('bluebird'),
	shortid = require('shortid');

shortid.worker(process.pid % 16);

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
		.table('folders', {readMode: 'majority'})
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
		var id = shortid.generate();
		return r
		.table('folders')
		.insert({
			'folderId': id,
			'accountId': accountId,
			'displayName': name,
			'description': description,
			'mutable': false,
			'parent': null
		})
		.run(r.conn)
		.then(function() {
			return id;
		})
	}),
	getMessageFolder: Promise.method(function(r, messageId) {
		return r
		.table('messages', {readMode: 'majority'})
		.get(messageId)
		.pluck('folderId')
		.run(r.conn)
		.then(function(result) {
			if (result !== null) {
				var folderId = result['folderId'];
				return r
				.table('folders')
				.get(folderId)
				.run(r.conn)
				.then(function(folder) {
					if (folder !== null) {
						return folder;
					}else{
						return null;
					}
				})
			}else{
				return null;
			}
		})
	})
}

var Promise = require('bluebird');

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
	})
}

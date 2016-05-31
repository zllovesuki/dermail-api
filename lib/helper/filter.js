var Promise = require('bluebird'),
	AhoCorasick = require('aho-corasick');

var self = module.exports = {
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
		var given = 0;
		var match = 0;

		var modified = false;

		if (arrayOfFrom !== null) {
			given++;
			match++;
			for (var k = 0, len = arrayOfFrom.length; k < len; k++) {
				email = arrayOfFrom[k] || '';
				var account = email.substring(0, email.lastIndexOf("@")).toLowerCase();
				var domain = email.substring(email.lastIndexOf("@") +1).toLowerCase();
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
			if (modified === false) {
				// criteria was given but no did not match
				match--;
			}
		}

		if (arrayOfTo !== null) {

			given++;
			match++;

			if (modified) {
				// credit default swap
				results = filtered;
				filtered = [];
				modified = false;
			}

			for (var k = 0, len = arrayOfTo.length; k < len; k++) {
				email = arrayOfTo[k] || '';
				var account = email.substring(0, email.lastIndexOf("@")).toLowerCase();
				var domain = email.substring(email.lastIndexOf("@") +1).toLowerCase();
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
			if (modified === false) {
				// criteria was given but no did not match
				match--;
			}
		}

		if (subject !== null) {

			given++;
			match++;

			if (modified) {
				// credit default swap
				results = filtered;
				filtered = [];
				modified = false;
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

			if (modified === false) {
				// criteria was given but no did not match
				match--;
			}
		}

		if (contain !== null) {

			given++;
			match++;

			if (modified) {
				// credit default swap
				results = filtered;
				filtered = [];
				modified = false;
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

			if (modified === false) {
				// criteria was given but no did not match
				match--;
			}
		}

		if (exclude !== null) {

			given++;
			match++;

			if (modified) {
				// credit default swap
				results = filtered;
				filtered = [];
				modified = false;
			}

			for (var i = 0, rlen = results.length; i < rlen; i++) {
				if (!self.containsAll(results[i].text.toLowerCase(), exclude)) {
					filtered.push(results[i]);
					modified = true;
				}
			}

			if (modified === false) {
				// criteria was given but no did not match
				match--;
			}
		}

		if (match === given) {
			return filtered;
		}else{
			return [];
		}
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
	isFalseReply: function(message) {
		if (message.subject.substring(0, 3).toLowerCase() === 're:' && typeof message.inReplyTo === 'undefined') {
			return true;
		}
		return false;
	}
}

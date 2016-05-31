var Promise = require('bluebird'),
	AhoCorasick = require('aho-corasick'),
	globToRegExp = require('glob-to-regexp');

var self = module.exports = {
	getFilters: Promise.method(function(r, accountId, transformFolder) {

		transformFolder = !!transformFolder;

		var constructor = Promise.method(function() {
			return r
			.table('filters')
			.getAll(accountId, { index: 'accountId'})
		})

		var transform = function(p) {
			if (!transformFolder) return p;
			return p.map(function(doc) {
				return doc.merge(function() {
					return {
						post: {
							folder: r.db('dermail').table('folders').get(doc('post')('folder'))
						}
					}
				})
			})
		}

		var get = function(p) {
			return p.concatMap(function(doc) {
				return doc('pre').keys()
				.map(function(key) {
					return {
						id: doc('filterId'),
						count: r.branch(doc('pre')(key).eq(null), 0, 1)
					}
				})
				.group('id')
				.reduce(function(left, right) {
					return {
						id: left('id'),
						count: left('count').add(right('count'))
					}
				})
				.ungroup()
				.map(function(red) {
					return {
						filterId: red('reduction')('id'),
						accountId: doc('accountId'),
						criteriaCount: red('reduction')('count'),
						pre: doc('pre'),
						post: doc('post')
					}
				})
			})
			.orderBy(r.desc('criteriaCount'))
		}

		var run = function(p) {
			return p.run(r.conn)
			.then(function(cursor) {
				return cursor.toArray();
			})
		}

		return constructor()
		.then(transform)
		.then(get)
		.then(run);
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
		var given = 0;
		var match = 0;
		var modified = false;

		var listOfTasks = [
			{
				key: 'from',
				value: arrayOfFrom
			},
			{
				key: 'to',
				value: arrayOfTo
			},
			{
				key: 'subject',
				value: subject
			},
			{
				key: 'contain',
				value: contain
			},
			{
				key: 'exclude',
				value: exclude
			}
		];

		var evaluation = {
			from: function(results, arrayOfFrom) {
				for (var k = 0, len = arrayOfFrom.length; k < len; k++) {
					email = arrayOfFrom[k] || '';
					for (var i = 0, rlen = results.length; i < rlen; i++) {
						var from = results[i].from;
						for (var j = 0, flen = from.length; j < flen; j++) {
							var eval = from[j].account + '@' + from[j].domain;
							var regex = globToRegExp(email);
							if (regex.test(eval)) {
								filtered.push(results[i]);
								modified = true;
							}
						}
					}
				}
			},
			to: function(results, arrayOfTo) {
				for (var k = 0, len = arrayOfTo.length; k < len; k++) {
					email = arrayOfTo[k] || '';
					for (var i = 0, rlen = results.length; i < rlen; i++) {
						var to = results[i].to;
						for (var j = 0, flen = to.length; j < flen; j++) {
							var eval = to[j].account + '@' + to[j].domain;
							var regex = globToRegExp(email);
							if (regex.test(eval)) {
								filtered.push(results[i]);
								modified = true;
							}
						}
					}
				}
			},
			subject: function(results, subject) {
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
			},
			contain: function(results, contain) {
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
			},
			exclude: function(results, exclude) {
				for (var i = 0, rlen = results.length; i < rlen; i++) {
					if (!self.containsAll(results[i].text.toLowerCase(), exclude)) {
						filtered.push(results[i]);
						modified = true;
					}
				}
			}
		};

		for (var i = 0; i < listOfTasks.length; i++) {
			if (given !== match) {
				return [];
			}
			if (listOfTasks[i].value !== null) {
				given++, match++;
				if (modified) {
					// credit default swap
					results = filtered;
					filtered = [];
					modified = false;
				}
				evaluation[listOfTasks[i].key](results, listOfTasks[i].value);
				if (modified === false) {
					// criteria was given but it was not matched
					match--;
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
	isFalseReply: function(message) {
		if (message.subject.substring(0, 3).toLowerCase() === 're:' && typeof message.inReplyTo === 'undefined') {
			return true;
		}
		return false;
	}
}

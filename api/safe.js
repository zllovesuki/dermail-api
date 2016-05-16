var express = require('express'),
	router = express.Router(),
	request = require('request')
	http = require('http'),
	_url = require('url'),
	emptyGif = new Buffer('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

router.get('/inline/*', function(req, res, next) {

	var r = req.r;

	var config = req.config;

	var base64 = req.query.s || '';
	var cid = new Buffer(base64, 'base64').toString();

	var contentId = cid.substring(4);

	r
	.table('attachments')
	.filter({
		contentId: contentId
	})
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(results) {
		if (results.length === 0) {
			res.setHeader('content-type', 'image/gif');
			res.end(emptyGif);
		}else{
			var attachment = results[0];
			// TODO: Don't hard code this
			var url = 'https://' + config.s3.bucket + '.' + config.s3.endpoint + '/' + attachment.checksum + '/' + attachment.generatedFileName;
			res.redirect(url);
		}
	})
});

router.get('/image/*', function(req, res, next) {

	var base64 = req.query.s || '';
	var url = new Buffer(base64, 'base64').toString();

	request({
		url: url,
		// Some websites are really being a dick about user-agent.
		headers: {
			'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.94 Safari/537.36'
		},
		timeout: 3000,
		maxRedirects: 2
	})
	.on('error', function(err) {
		res.setHeader('content-type', 'image/gif');
		res.end(emptyGif);
	})
	.pipe(res);
});

router.get('/href/*', function(req, res, next) {
	var base64 = req.query.s || '';
	var url = new Buffer(base64, 'base64').toString();
	res.redirect(url);
});

module.exports = router;

var express = require('express'),
	router = express.Router(),
	request = require('request')
	http = require('http'),
	_url = require('url'),
	emptyGif = new Buffer('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

router.get('/inline/*', function(req, res, next) {
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
			var url = 'https://dermail-attachments.s3.fmt01.sdapi.net/' + attachment.checksum + '/' + attachment.generatedFileName;
			res.redirect(url);
		}
	})
});

router.get('/image/*', function(req, res, next) {

	var base64 = req.query.s || '';
	var url = new Buffer(base64, 'base64').toString();

	request({
		url: url,
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

var knox = require('knox'),
	config = require('./config');

var s3 = knox.createClient(config.s3);

var expires = new Date();
expires.setMinutes(expires.getMinutes() + 30);
var url = s3.signedUrl('/dermail-attachments/1.jpg', expires, {
	verb: 'POST'
});

console.log(url);

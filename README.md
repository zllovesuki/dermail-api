## dermail-api

[![build status](https://git.fm/zllovesuki/dermail-api/badges/master/build.svg)](https://git.fm/zllovesuki/dermail-api/commits/master)

Central API/Worker for Dermail System.

[Changelog](./CHANGELOG.md)

[API Guide](./API.md)

[System Architecture](https://jerry.im/essays/2016/02/dermail/)

---

## Pro Tips

### nginx rever proxy

Supposed that you are running nginx (machine A, 192.168.0.10), and you have two Dermail-API instances running (machines B and C, .11, .12).

In nginx's config file:
```nginx
upstream dermail-api {
	least_conn;
	server 192.168.0.11:2000;
	server 192.168.0.11:2001;
	server 192.168.0.11:2002;
	server 192.168.0.11:2003;
	server 192.168.0.12:2000;
	server 192.168.0.12:2001;
	server 192.168.0.12:2002;
	server 192.168.0.12:2003;
}

upstream dermail-socket {
	ip_hash;
	server 192.168.0.11:2000;
	server 192.168.0.11:2001;
	server 192.168.0.11:2002;
	server 192.168.0.11:2003;
	server 192.168.0.12:2000;
	server 192.168.0.12:2001;
	server 192.168.0.12:2002;
	server 192.168.0.12:2003;
}
```

Notice the difference between socket and API. We want the socket connection to be "sticky", thus the ip_hash. Otherwise, the API requests are distributed across processes.

Then, in your API.conf:
```nginx
server {
	listen 443 ssl http2;

	server_name dermail.api.blue;

	include /path/to/ssl-configuration;
    ssl_certificate /path/to/cert;
    ssl_certificate_key     /path/to/key;

	location ~* \.io {
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_http_version 1.1;
        proxy_pass http://dermail-socket;
		proxy_redirect off;
	}

    location / {
        proxy_set_header Accept-Encoding "";
		proxy_set_header	X-Forwarded-For	$remote_addr;
        proxy_pass http://dermail-api;
    }

}
```

### account ownership transfer

Currently this requires open heart surgery, a.k.a. querying directly in the database. This functionality will not be implmented in the API as this is usually very messy.

Before everything, take notes of the userId of the **old user**.

First, create a new user:
```javascript
r.table('users').insert({
	firstName: 'Your first name',
	lastName: 'Your last name',
	username: 'Username to login',
	password: 'bcrypt hashed password. I usually salt it 20 times'
})
```
Take a notes of the "generated_keys", that's the userId of the **new user**.

Then, transfer account ownership:
```javascript
r.table('accounts').get('accountId here').update({
	userId: 'new userId'
})
```

Optionally, transfer the domain ownership:
```javascript
r.table('domains').get('domainId here').update({
	domainAdmin: 'new userId'
})
```

Lastly, update the address book:
```javascript
r.table('addresses').filter(function(doc) {
	return doc('accountId').eq('accountId here');
})
```
Then, in the results, find an address with an internalOwner, update the internalOwner to the new user. **DO NOT UPDATE THE null ONES, YOU WILL BREAK EVERYTHING**
```javascript
r.table('addresses').get('addressId here').update({
	internalOwner: 'new userId'
})
```

That's it.

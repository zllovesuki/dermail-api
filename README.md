## dermail-api

[![build status](https://git.fm/zllovesuki/dermail-api/badges/master/build.svg)](https://git.fm/zllovesuki/dermail-api/commits/master)

Central API/Worker for Dermail System.

[Changelog](./CHANGELOG.md)

[API Guide](./API.md)

[System Architecture](https://jerry.im/essays/2016/02/dermail/)

---

## Pro Tips

Supposed that you are running nginx (machine A, 192.168.0.10), and you have two Dermail-API instances running (machines B and C, .11, .12).

In nginx's config file:
```
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
```
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

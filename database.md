# Database

```javascript
r.db('dermail').tableCreate('accounts', {
  primaryKey: 'accountId'
})
r.db('dermail').tableCreate('addresses', {
  primaryKey: 'addressId'
})
r.db('dermail').tableCreate('attachments', {
  primaryKey: 'attachmentId'
})
r.db('dermail').tableCreate('domains', {
  primaryKey: 'domainId'
})
r.db('dermail').tableCreate('folders', {
  primaryKey: 'folderId'
})
r.db('dermail').tableCreate('pushSubscriptions', {
  primaryKey: 'userId'
})
r.db('dermail').tableCreate('messageHeaders', {
  primaryKey: 'headerId'
})
r.db('dermail').tablseCreate('messages', {
  primaryKey: 'messageId'
})
r.db('dermail').tableCreate('queue', {
  primaryKey: 'queueId'
})
r.db('dermail').tableCreate('users', {
  primaryKey: 'userId'
})
r.db('dermail').tableCreate('filters', {
  primaryKey: 'filterId'
})
r.db('dermail').tableCreate('bayesStore', {
  primaryKey: 'key'
})
r.db('dermail').tableCreate('bayesFrequency', {
  primaryKey: 'key'
})
r.db('dermail').tableCreate('greylist', {
  primaryKey: 'hash'
})
```

```javascript
r.db('dermail').table("users").indexCreate("username")
r.db('dermail').table("accounts").indexCreate("userId")
r.db('dermail').table("folders").indexCreate("accountId")
r.db('dermail').table("messages").indexCreate("accountId")
r.db('dermail').table("messages").indexCreate("folderId")
r.db('dermail').table("messages").indexCreate("_messageId")
r.db('dermail').table("queue").indexCreate("userId")
r.db('dermail').table("filters").indexCreate("accountId")
r.db('dermail').table("attachments").indexCreate("checksum")
r.db('dermail').table("attachments").indexCreate("contentId")
r.db('dermail').table("greylist").indexCreate("lastSeen")
```


compound index of folderId + date (savedOn) in table "messages"
```javascript
r.db('dermail').table('messages').indexCreate('folderSaved', [ r.row('folderId'),  r.row('savedOn')])
```

Add secondary index of "folderId" and "isRead" to table "messages" as "unreadCount"
```javascript
r.db('dermail').table('messages').indexCreate('unreadCount', [r.row('folderId'), r.row('isRead')])
```

user and account mapping in "accounts"
```javascript
r.db('dermail').table('accounts').indexCreate('userAccountMapping', [ r.row('userId'),  r.row('accountId')])
```

message and account mapping in "messages"
```javascript
r.db('dermail').table('messages').indexCreate('messageAccountMapping', [r.row('messageId'), r.row('accountId')])
```

account and folder mapping in "folders"
```javascript
r.db('dermail').table('folders').indexCreate('accountFolderMapping', [ r.row('accountId'),  r.row('folderId')])
```

# TO DO for rx

secondary index of "domain" to table "domains"
```javascript
r.db('dermail').table('domains').indexCreate("domain")
```

secondary (multi) index of "alias" to table "domains" `.indexCreate("alias", {multi: true})`
```javascript
r.db('dermail').table('domains').indexCreate("alias", {multi: true})
```

compound index of account + domainId in table "accounts"
```javascript
r.db('dermail').table('accounts').indexCreate('accountDomainId', [ r.row('account'),  r.row('domainId')])
```

compound index of account + domain in table "addresses"
```javascript
r.db('dermail').table('addresses').indexCreate('accountDomain', [ r.row('account'),  r.row('domain')])
```

compound index of account + domain + accountId in table "addresses"
```javascript
r.db('dermail').table('addresses').indexCreate('accountDomainAccountId', [ r.row('account'),  r.row('domain'), r.row('accountId')])
```

compound index of accountId + 'Index' in table "addresses"
```javascript
r.db('dermail').table('folders').indexCreate('inboxAccountId', [ r.row('displayName'),  r.row('accountId') ])
```

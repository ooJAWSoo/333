/*
 * =============================================================================
 *
 *      Filename:   app.js
 *
 *   Description:   Root server file, acts as the point of connection between
 *                  client and routing logic.
 *
 *      Version:    0.0.1
 *      Created:    3/5/14 3:31:18 AM
 *
 *       Author:    Collin Stedman
 *
 * =============================================================================
 */

/* File system */
var fs = require('fs');

/* HTTP and HTTPS */
var http = require('http');
var https = require('https');

/* SSL files */
var privateKey = fs.readFileSync('server.key', 'utf8');
var certificate = fs.readFileSync('server.crt', 'utf8');
var pem_key = fs.readFileSync('pem_key', 'utf8');
var credentials = { 
  key: privateKey, 
  cert: certificate,
  passphrase: pem_key
};

/* Secret key to be used later */
var secret = require('./keyfile.js');

/* Express */
var express = require('express');
var app = express();

/* Our VPS is behind a reverse proxy */
app.enable('trust proxy');

/* Redirect HTTP to HTTPS */
app.use(function (req, res, next) {
  if (req.protocol === 'https') {
    next();
  }
  else {
    // Hardcoded port conversion, remove for live deployment
    var new_url = 'https://' + req.headers.host.slice(0, -5) + ':8443' + req.url;
    res.redirect(new_url);
  }
});

/* HSTS */
app.use(function (req, res, next) {
  res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return next();
});

/* DB and sessions */
var CasStore = require('connect-cassandra-cql')(express),
    cql = require('node-cassandra-cql'),
    CasClient = cql.Client;
var client = new CasClient({ hosts: ['localhost'], keyspace: 'blabrr' });
var config = { client: client };
app.use(express.cookieParser())
   .use(express.json())
   .use(express.urlencoded())
   .use(express.session({
     secret: secret, 
     key: 'sid', 
     cookie: {
       secure: true
     },
     store: new CasStore(config)
   }));

/* Flash messages */
var flash = require('connect-flash');
app.use(flash());

/* Static file serving */
app.use(express.compress())
   .use(express.static(__dirname + '/public'));

/* Passport */
var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;
passport.use(new LocalStrategy(
  function(username, password, done) {
    var query = 'SELECT * FROM users WHERE username=?';
    client.executeAsPrepared(query, [username], cql.types.consistencies.one, function (err, user) {
      if (err) { 
        return done(err); 
      }
      if (!user.rows[0]) {
        return done(null, false, { 'message': 'Incorrect username.' }); 
      }
      if (user.rows[0].password != password) {
        return done(null, false, { 'message': 'Incorrect password.' });
      }
      return done(null, user.rows[0]);
    });
  }
));
passport.serializeUser(function(user, done) {
  // Create user ID somehow
  done(null, user.username);
});
passport.deserializeUser(function(id, done) {
  var query = 'SELECT * FROM users WHERE username=?';
  client.executeAsPrepared(query, [id], cql.types.consistencies.one, function (err, user) {
    done(err, user.rows[0]);
  });
});
app.use(passport.initialize())
   .use(passport.session());

/* Jade templating */
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');

/* Routing */
app.get('/', function(req, res) {
  if (req.user) {
    res.render('home.jade');
  }
  else {
    res.render('front.jade');
  }
});
app.get('/user', function(req, res) {
  res.send('Hello, ' + req.user.username + '!');
  console.log(req.user);
  console.log(req.session);
});
app.get('/test', function(req, res) {
  res.render('home.jade');
});
app.get('/login', function(req, res) {
  // MAKE THIS A NEW PAGE
  res.render('front.jade', { flash: req.flash('error') });
});
app.post('/login', 
  passport.authenticate('local', { successRedirect: '/',
                                   failureRedirect: '/login',
                                   failureFlash: true }));
app.get('/logout', function(req, res) {
  req.logout();
  res.redirect('/');
});
app.post('/signup', function(req, res) {
  var query = 'INSERT INTO users (username, password) values (?, ?)';
  client.executeAsPrepared(query, [req.body.username, req.body.password],
                            cql.types.consistencies.one, function (err) {
    if (err) {
      // Do something better here
      console.log(err);
    }
    else {
      res.redirect('/');
    }
  });
});

/* Create HTTP and HTTPS servers with Express object */
var httpServer = http.createServer(app);
var httpsServer = https.createServer(credentials, app);
httpServer.listen(8080);
httpsServer.listen(8443);

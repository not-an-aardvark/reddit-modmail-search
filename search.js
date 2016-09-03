'use strict';
/* global snoowrap */
var REDDIT_APP_ID = '3JkC9UHWUz83Ew';
var REDIRECT_URI = 'https://not-an-aardvark.github.io/reddit-modmail-search/';

var USER_AGENT = 'reddit modmail search by /u/not_an_aardvark || https://github.com/not-an-aardvark/reddit-modmail-search';
var REQUIRED_SCOPES = ['privatemessages'];
var cachedRequester;
var accessTokenPromise;
var currentListing;
var count = 0;
var loadingMessage = document.getElementById('loading-message');

var query = parseQueryString(location.search);
var cookies = parseCookieString(document.cookie);

function parseQueryString (str) {
  if (!str) {
    return {};
  }
  var obj = {};
  var pieces = str.slice(1).split('&');
  for (var i = 0; i < pieces.length; i++) {
    var pair = pieces[i].split('=');
    obj[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
  }
  return obj;
}

function parseCookieString (cookieString) {
  var obj = {};
  var splitCookies = cookieString.split('; ');
  splitCookies.forEach(function (cookie) {
    var pair = cookie.split('=');
    obj[pair[0]] = pair[1];
  });
  return obj;
}

var getAuthRedirect = function (state) {
  return `https://reddit.com/api/v1/authorize
?client_id=${REDDIT_APP_ID}
&response_type=code
&state=${encodeURIComponent(state)}
&redirect_uri=${encodeURIComponent(REDIRECT_URI)}
&duration=temporary
&scope=${REQUIRED_SCOPES.join('%2C')}
`;
};

function getAccessToken () {
  if (accessTokenPromise) {
    return accessTokenPromise;
  }
  accessTokenPromise = cookies.access_token && !query.code
    ? Promise.resolve(cookies.access_token)
    : snoowrap.prototype.credentialed_client_request.call({
      user_agent: USER_AGENT,
      client_id: REDDIT_APP_ID,
      client_secret: ''
    }, {
      method: 'post',
      url: 'https://www.reddit.com/api/v1/access_token',
      form: {grant_type: 'authorization_code', code: query.code, redirect_uri: REDIRECT_URI}
    }).then(function (response) {
      if (!response.access_token) {
        throw new Error('Authentication failed');
      }
      document.cookie = `access_token=${response.access_token}; max-age=3600`;
      cookies.access_token = response.access_token;
      return response.access_token;
    });
  return accessTokenPromise;
}

function getRequester (access_token) {
  if (cachedRequester) {
    return cachedRequester;
  }
  cachedRequester = new snoowrap({user_agent: USER_AGENT, access_token});
  cachedRequester.config({debug: true, request_delay: 1000});
  return cachedRequester;
}

function satisfiesQuery (message, searchQuery) {
  return searchQuery.split(' ').map(function (word) {
    return RegExp(word, 'i');
  }).some(function (regex) {
    return regex.test(message.body) || regex.test(message.subject) || regex.test(message.author.name);
  });
}

function flattenTree (message) {
  return message.replies ? message.replies.map(flattenTree).reduce(function (acc, next) {
    return acc.concat(next);
  }, []).concat(message) : [message];
}

function escapeHtml (str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

var resultsList = document.getElementById('results-list');
function addMessageToDisplay (message) {
  var formatted = `"<a href="https://reddit.com/message/messages/${escapeHtml(message.id)}">${message.subject}</a>" by /u/${escapeHtml(message.author.name)}, on /r/${escapeHtml(message.subreddit.display_name)}, on ${escapeHtml(new Date(message.created_utc * 1000).toString())}`;
  var li = document.createElement('li');
  li.innerHTML = formatted;
  resultsList.appendChild(li);
}

function getBatch () {
  document.getElementById('loading-message').style.display = 'block';
  if (currentListing) {
    if (currentListing.is_finished) {
      document.getElementById('loading-message').style.display = 'none';
    }
    return currentListing.fetchMore({amount: 100, append: false});
  }
  return getAccessToken(query.code)
    .then(getRequester)
    .then(function (r) {
      return r.getModmail({limit: 100});
    });
}

function onSubmitClicked () { // eslint-disable-line no-unused-vars
  var searchQuery = document.getElementById('search-query').value;
  document.getElementById('loading-message').style.display = 'block';
  if (cookies.access_token || query.code) {
    return start(searchQuery);
  }
  window.location = getAuthRedirect(searchQuery);
}

function start (searchQuery) {
  return getBatch()
    .tap(function (result) {
      currentListing = result;
    })
    .map(flattenTree)
    .reduce(function (acc, next) {
      return acc.concat(next);
    }, [])
    .tap(function (result) {
      count += result.length;
      loadingMessage.innerHTML = `Loading... ${count} modmails processed so far`;
    })
    .filter(function (message) {
      return satisfiesQuery(message, searchQuery);
    })
    .mapSeries(addMessageToDisplay)
    .catch(function (err) {
      document.getElementById('error-output').innerHTML = 'An unknown error occured. Check the dev console for more details.';
      throw err;
    })
    .then(function () {
      return start(searchQuery);
    });
}

document.addEventListener('DOMContentLoaded', function () {
  if (cookies.access_token || query.code) {
    getAccessToken();
  }
  if (query.state) {
    var searchQuery = decodeURIComponent(query.state);
    document.getElementById('search-query').value = searchQuery;
    return start(searchQuery);
  }
});

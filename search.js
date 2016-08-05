'use strict';
/* global snoowrap */
const REDDIT_APP_ID = '3JkC9UHWUz83Ew';
const REDIRECT_URI = 'https://not-an-aardvark.github.io/reddit-modmail-search/';

const USER_AGENT = 'reddit modmail search by /u/not_an_aardvark || https://github.com/not-an-aardvark/reddit-modmail-search';
const REQUIRED_SCOPES = ['privatemessages'];
let cachedRequester;
let accessTokenPromise;
let currentListing;
let count = 0;
const loadingMessage = document.getElementById('loading-message');

const query = parseQueryString(location.search);
const cookies = parseCookieString(document.cookie);

function parseQueryString (str) {
  if (!str) {
    return {};
  }
  const obj = {};
  const pieces = str.slice(1).split('&');
  for (let i = 0; i < pieces.length; i++) {
    const pair = pieces[i].split('=');
    obj[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
  }
  return obj;
}

function parseCookieString (cookieString) {
  const obj = {};
  const splitCookies = cookieString.split('; ');
  splitCookies.forEach(cookie => {
    const pair = cookie.split('=');
    obj[pair[0]] = pair[1];
  });
  return obj;
}

const getAuthRedirect = state =>
`https://reddit.com/api/v1/authorize
?client_id=${REDDIT_APP_ID}
&response_type=code
&state=${encodeURIComponent(state)}
&redirect_uri=${encodeURIComponent(REDIRECT_URI)}
&duration=temporary
&scope=${REQUIRED_SCOPES.join('%2C')}
`;

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
    }).then(response => {
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
  return searchQuery.split(' ').map(word => RegExp(word, 'i')).some(regex => regex.test(message.body) || regex.test(message.subject) || regex.test(message.author.name));
}

function flattenTree (message) {
  return message.replies ? message.replies.map(flattenTree).reduce((acc, next) => acc.concat(next), []).concat(message) : [message];
}

function escapeHtml (str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const resultsList = document.getElementById('results-list');
function addMessageToDisplay (message) {
  const formatted = `"<a href="https://reddit.com/message/messages/${escapeHtml(message.id)}">${message.subject}</a>" by /u/${escapeHtml(message.author.name)}, on /r/${escapeHtml(message.subreddit.display_name)}, on ${escapeHtml(new Date(message.created_utc * 1000).toString())}`;
  const li = document.createElement('li');
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
    .then(r => r.getModmail({limit: 100}));
}

function onSubmitClicked () { // eslint-disable-line no-unused-vars
  const searchQuery = document.getElementById('search-query').value;
  document.getElementById('loading-message').style.display = 'block';
  if (cookies.access_token || query.code) {
    return start(searchQuery);
  }
  window.location = getAuthRedirect(searchQuery);
}

function start (searchQuery) {
  return getBatch()
    .tap(result => {
      currentListing = result;
    })
    .map(flattenTree)
    .reduce((acc, next) => acc.concat(next), [])
    .tap(result => {
      count += result.length;
      loadingMessage.innerHTML = `Loading... ${count} modmails processed so far`;
    })
    .filter(message => satisfiesQuery(message, searchQuery))
    .mapSeries(addMessageToDisplay)
    .catch(err => {
      document.getElementById('error-output').innerHTML = 'An unknown error occured. Check the dev console for more details.';
      throw err;
    })
    .then(() => start(searchQuery));
}

document.addEventListener('DOMContentLoaded', () => {
  if (cookies.access_token || query.code) {
    getAccessToken();
  }
  if (query.state) {
    const searchQuery = decodeURIComponent(query.state);
    document.getElementById('search-query').value = searchQuery;
    return start(searchQuery);
  }
});

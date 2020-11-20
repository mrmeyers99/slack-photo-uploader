const { App } = require('@slack/bolt');
const mysql = require('mysql');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Initializes your app with your bot token and signing secret
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});
const token = process.env.SLACK_BOT_TOKEN;
const albumId = process.env.GOOGLE_PHOTOS_ALBUM_ID;

(async () => {
  let accessToken = await refreshToken();
  console.log('Got an access token');
  const refreshInterval = 60 * 60 * 1000;
  setInterval(function() {
    refreshToken().then((newToken) => {
      accessToken = newToken
      console.log('Refreshed the access token');
    });
  }, refreshInterval);
  // Start your app
  await app.start(process.env.PORT || 3020);

  // Listens to incoming messages that contain "hello"
  app.event('reaction_added', async ({ event, client }) => {
    if (event.reaction === 'up') {
      try {
        console.log(event);
        const message = await client.conversations.history({
          'channel': event.item.channel,
          'latest': event.item.ts,
          'limit': 1,
          'inclusive': true
        });

        const start = async () => {
          await asyncForEach(message.messages[0].files, async (file) => {
            console.log(file);
            console.log(token);
            await downloadImage(file.url_private_download, file.id)
              .then((res) => uploadMedia(file, accessToken))
              .then((uploadToken) => createMediaItem(file, uploadToken, accessToken));
            fs.unlinkSync(file.id)
          });

          await client.reactions.add({
            "channel": event.item.channel,
            "name": "heavy_check_mark",
            "timestamp": event.item.ts
          })
          console.log('Done');
        }
        await start();
      }
      catch (error) {
        console.error(error);
      }
    }
  });

  console.log('⚡️ Bolt app is running!');
})();

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

async function refreshToken() {
  const bodyFormData = new FormData();
  bodyFormData.append('client_id', process.env.GOOGLE_CLIENT_ID);
  bodyFormData.append('client_secret', process.env.GOOGLE_CLIENT_SECRET);
  bodyFormData.append('refresh_token', process.env.GOOGLE_REFRESH_TOKEN);
  bodyFormData.append('grant_type', 'refresh_token');
  const result = await axios.post('https://accounts.google.com/o/oauth2/token', bodyFormData, {
    headers: bodyFormData.getHeaders()
  }).catch(function(err) {
    console.log(err);
    throw err;
  });
  return result.data.access_token;
}

async function uploadMedia(file, accessToken) {
  console.log('Download complete.  Uploading...');
  return await axios.post('https://photoslibrary.googleapis.com/v1/uploads', fs.createReadStream(file.id),{
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-type': 'application/octet-stream',
      'X-Goog-Upload-Content-Type': file.mimetype,
      'X-Goog-Upload-Protocol': 'raw'
    }
  }).then(function(res) {
    const uploadToken = res.data;
    console.log(res.data);
    return uploadToken
  });
}

async function createMediaItem(file, uploadToken, accessToken) {
  console.log('Upload complete.  Creating media item...');
  return await axios.post('https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate', {
    "albumId": albumId,
    "newMediaItems": [
      {
        "description": file.title,
        "simpleMediaItem": {
          "uploadToken": uploadToken,
          "fileName": file.name
        }
      }
    ]
  }, {
    headers: {
      'Authorization': 'Bearer ' + accessToken
    }
  })
  .then(function(createMediaResponse) {
    console.log(createMediaResponse.data);
    return createMediaResponse.data;
  });
}

async function downloadImage(url, file) {
  const filePath = path.resolve(__dirname, file)
  const writer = fs.createWriteStream(filePath)

  const response = await axios({
    url,
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token
    },
    responseType: 'stream'
  })

  response.data.pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

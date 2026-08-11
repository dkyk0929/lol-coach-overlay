const https = require('https')
const fs = require('fs')

const config = JSON.parse(fs.readFileSync('C:\\Users\\bdann\\AppData\\Roaming\\lol-coach-overlay\\config.json', 'utf8'))
const geminiApiKey = config.geminiApiKey

const systemText = 'You are a League of Legends post-game coach. Analyze why the player won or lost based on their stats and key events. Give 3-4 specific sentences. Identify the single most important factor and one concrete thing to improve next game. Reference their champion, role, and actual numbers. No fluff. No markdown, no asterisks, no bold formatting — plain text only.'
const userText = `Game result: Win
My champion: Mel (Mid) — mid game ended at 34:44
KDA: 15/5/10 | CS/min: 5.5
Drakes: Ally 4 vs Enemy 1
Ally team: Mel, Sett, Naafiri, Smolder, Neeko
Enemy team: Zaahen, Diana, Yasuo, Ashe, Brand
Key events: 31:30 3 enemies down - take Dragon or Baron now! | 32:08 Inhibitor down - super minions incoming | 33:18 3 enemies down - take Dragon or Baron now! | 33:26 4 enemies down - take Dragon or Baron now! | 33:56 Allied Baron - group and push
In 3-4 sentences, explain the main reason we won and the top 1-2 things to improve. Be specific. Reference champions and stats.`

const body = JSON.stringify({
  contents: [{
    parts: [{ text: userText }]
  }],
  systemInstruction: {
    parts: [{ text: systemText }]
  },
  generationConfig: {
    maxOutputTokens: 200,
    thinkingConfig: {
      thinkingBudget: 0
    }
  }
})

const req = https.request({
  hostname: 'generativelanguage.googleapis.com',
  path: `/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${geminiApiKey}`,
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  },
}, (res) => {
  let data = ''
  res.on('data', c => data += c)
  res.on('end', () => {
    console.log('STATUS:', res.statusCode)
    console.log('RAW RESPONSE:')
    console.log(data)
  })
})
req.write(body)
req.end()

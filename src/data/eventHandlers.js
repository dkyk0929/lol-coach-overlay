// Returns an alert object { msg, cat, pri } or null to ignore the event.
function handleGameEvent(event, activeName, allPlayers) {
  const t = event.EventTime
  const isAlly = (name) => {
    const me = allPlayers.find((p) => matchName(p.summonerName, activeName))
    const target = allPlayers.find((p) => matchName(p.summonerName, name))
    return me && target && me.team === target.team
  }
  const nextSpawn = (offsetSecs) => {
    const total = t + offsetSecs
    const m = Math.floor(total / 60)
    const s = String(Math.floor(total % 60)).padStart(2, '0')
    return `${m}:${s}`
  }

  switch (event.EventName) {
    case 'FirstBlood':
      if (matchName(event.KillerName, activeName))
        return { msg: '🔴 First Blood! Stay focused, don\'t over-chase', cat: 'kill', pri: 'normal' }
      if (matchName(event.VictimName, activeName))
        return { msg: '🔴 You gave First Blood — play safe, farm back', cat: 'kill', pri: 'warning' }
      return { msg: '🔴 First Blood — enemy team', cat: 'kill', pri: 'normal' }

    case 'ChampionKill':
      if (matchName(event.VictimName, activeName))
        return { msg: '💀 You died — shove wave when you respawn', cat: 'wave', pri: 'warning' }
      if (matchName(event.KillerName, activeName))
        return { msg: '⚔ Kill! Crash the wave now', cat: 'wave', pri: 'normal' }
      return null

    case 'DragonKill': {
      const ally   = isAlly(event.KillerName)
      const stolen = event.Stolen === 'True'
      const next   = nextSpawn(300)
      if (stolen && !ally) return { msg: `🐉 Dragon stolen! Next at ${next}`, cat: 'objective', pri: 'urgent' }
      if (ally)            return { msg: `🐉 Allied Dragon. Next at ${next}`, cat: 'objective', pri: 'normal' }
      return               { msg: `🐉 Enemy Dragon. Next at ${next}`,         cat: 'objective', pri: 'warning' }
    }

    case 'BaronKill': {
      const ally   = isAlly(event.KillerName)
      const stolen = event.Stolen === 'True'
      if (!ally) return { msg: stolen ? '🟣 Baron stolen! Defend base' : '🟣 Enemy Baron — avoid open fights', cat: 'macro', pri: 'urgent' }
      return             { msg: stolen ? '🟣 Baron stolen! Push now'   : '🟣 Allied Baron — group and push',   cat: 'macro', pri: 'urgent' }
    }

    case 'RiftHeraldKill': {
      const ally = isAlly(event.KillerName)
      if (!ally) return { msg: '⚔ Enemy Herald — expect tower dive', cat: 'macro', pri: 'warning' }
      return             { msg: '⚔ Allied Herald! Use it on a tower', cat: 'macro', pri: 'normal' }
    }

    case 'TurretKilled':
      return { msg: '🏰 Tower down — crash wave into next tower', cat: 'wave', pri: 'normal' }

    case 'InhibKilled':
      return { msg: '⚠ Inhibitor down — super minions incoming', cat: 'macro', pri: 'urgent' }

    case 'InhibRespawned':
      return { msg: 'Inhibitor respawned — super minion buff gone', cat: 'macro', pri: 'normal' }

    default:
      return null
  }
}

// Loose match — handles "Name" vs "Name#TAG" Riot ID formats
function matchName(a, b) {
  if (!a || !b) return false
  const clean = (s) => s.split('#')[0].toLowerCase().trim()
  return clean(a) === clean(b)
}

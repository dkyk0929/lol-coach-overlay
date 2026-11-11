// Returns an alert object { msg, cat, pri } or null to ignore the event.
function handleGameEvent(event, activeName, allPlayers, myTeam) {
  const t = event.EventTime
  const resolvedTeam = myTeam ?? findPlayerByName(allPlayers, activeName)?.team
  const isAllyEvent = (ev) => {
    if (!resolvedTeam) return false
    const killer = findPlayerByName(allPlayers, ev.KillerName)
    if (killer?.team) return killer.team === resolvedTeam
    if (Array.isArray(ev.Assisters) && ev.Assisters.length > 0) {
      let allyCount = 0, enemyCount = 0
      for (const a of ev.Assisters) {
        const p = findPlayerByName(allPlayers, a)
        if (p?.team === resolvedTeam) allyCount++
        else if (p?.team) enemyCount++
      }
      if (allyCount > 0 || enemyCount > 0) return allyCount >= enemyCount
    }
    return false
  }
  const nextSpawn = (offsetSecs) => {
    const total = t + offsetSecs
    const m = Math.floor(total / 60)
    const s = String(Math.floor(total % 60)).padStart(2, '0')
    return `${m}:${s}`
  }

  switch (event.EventName) {
    case 'FirstBlood':
      if (isMeEvent(event.KillerName, activeName, allPlayers))
        return { msg: '🔴 First Blood — yours', cat: 'kill', pri: 'normal' }
      if (isMeEvent(event.VictimName, activeName, allPlayers))
        return { msg: '🔴 You gave up First Blood', cat: 'kill', pri: 'warning' }
      if (isAllyEvent(event))
        return { msg: '🔴 First Blood — your team', cat: 'kill', pri: 'normal' }
      return { msg: '🔴 First Blood — enemy team', cat: 'kill', pri: 'normal' }

    case 'ChampionKill':
      if (isMeEvent(event.VictimName, activeName, allPlayers))
        return { msg: '💀 You died', cat: 'wave', pri: 'warning' }
      if (isMeEvent(event.KillerName, activeName, allPlayers))
        return { msg: '⚔ Kill — wave is open', cat: 'wave', pri: 'normal' }
      return null

    case 'DragonKill': {
      const ally   = isAllyEvent(event)
      const stolen = event.Stolen === 'True'
      const next   = nextSpawn(300)
      if (stolen && !ally) return { msg: `🐉 Dragon stolen! Next at ${next}`, cat: 'objective', pri: 'urgent' }
      if (ally)            return { msg: `🐉 Allied Dragon. Next at ${next}`, cat: 'objective', pri: 'normal' }
      return               { msg: `🐉 Enemy Dragon. Next at ${next}`,         cat: 'objective', pri: 'warning' }
    }

    case 'BaronKill': {
      const ally   = isAllyEvent(event)
      const stolen = event.Stolen === 'True'
      if (!ally) return { msg: stolen ? '🟣 Baron stolen by the enemy' : '🟣 Enemy has Baron buff', cat: 'macro', pri: 'urgent' }
      return             { msg: stolen ? '🟣 Baron stolen — your team has the buff' : '🟣 Your team has Baron buff', cat: 'macro', pri: 'urgent' }
    }

    case 'RiftHeraldKill': {
      const ally = isAllyEvent(event)
      if (!ally) return { msg: '⚔ Enemy has Rift Herald', cat: 'macro', pri: 'warning' }
      return             { msg: '⚔ Your team has Rift Herald', cat: 'macro', pri: 'normal' }
    }

    case 'TurretKilled':
      return { msg: '🏰 Tower down', cat: 'wave', pri: 'normal' }

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
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false
  const clean = (s) => s.split('#')[0].toLowerCase().trim()
  const ca = clean(a), cb = clean(b)
  return ca.length > 0 && ca === cb
}

function matchPlayer(p, name) {
  if (!p || !name) return false
  return (
    matchName(p.summonerName, name) ||
    matchName(p.riotId, name) ||
    matchName(p.riotIdGameName, name) ||
    matchName(p.championName, name) ||
    matchName(p.rawChampionName?.replace(/^game_character_displayname_/i, ''), name)
  )
}

function findPlayerByName(allPlayers, name) {
  if (!name || !Array.isArray(allPlayers)) return null
  return allPlayers.find((p) => matchPlayer(p, name)) ?? null
}

function isMeEvent(eventPlayerName, activeName, allPlayers) {
  if (matchName(eventPlayerName, activeName)) return true
  const me = findPlayerByName(allPlayers, activeName)
  return me ? matchPlayer(me, eventPlayerName) : false
}


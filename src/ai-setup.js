// ── DOM refs ─────────────────────────────────────────────────────────────────
const statusBar   = document.getElementById('status-bar')
const statusDot   = document.getElementById('status-dot')
const statusText  = document.getElementById('status-text')
const keyInput    = document.getElementById('key-input')
const saveBtn     = document.getElementById('save-btn')
const keyLabel    = document.getElementById('key-label')
const feedback    = document.getElementById('save-feedback')
const closeBtn    = document.getElementById('close-btn')
const activateBtn = document.getElementById('activate-btn')

const tabAnthropic = document.getElementById('tab-anthropic')
const tabGemini    = document.getElementById('tab-gemini')
const howToAnthropic = document.getElementById('how-to-anthropic')
const howToGemini    = document.getElementById('how-to-gemini')

// ── State variables ──────────────────────────────────────────────────────────
let activeTab = 'anthropic' // 'anthropic' | 'gemini'
let hasAnthropicKey = false
let hasGeminiKey = false
let aiProvider = 'anthropic'

// ── Close button ──────────────────────────────────────────────────────────────
closeBtn.addEventListener('click', () => window.aiSetup.close())

// ── Link: open external URLs ─────────────────────────────────────────
document.querySelectorAll('.link').forEach(el => {
  const url = el.getAttribute('data-url') || 'https://console.anthropic.com'
  el.addEventListener('click', () => window.aiSetup.openUrl(url))
})

// ── Init: check current status ───────────────────────────────────────────────
async function init() {
  const status = await window.aiSetup.getStatus()
  hasAnthropicKey = status.hasAnthropicKey
  hasGeminiKey = status.hasGeminiKey
  aiProvider = status.aiProvider || 'anthropic'
  
  // Set tab to currently active provider
  switchTab(aiProvider)
}

function switchTab(tab) {
  activeTab = tab
  
  // Toggle tab buttons CSS
  tabAnthropic.classList.toggle('active', tab === 'anthropic')
  tabGemini.classList.toggle('active', tab === 'gemini')
  
  // Toggle instructions visibility
  howToAnthropic.classList.toggle('hidden', tab !== 'anthropic')
  howToGemini.classList.toggle('hidden', tab !== 'gemini')
  
  updateUI()
}

// Bind tab click events
tabAnthropic.addEventListener('click', () => switchTab('anthropic'))
tabGemini.addEventListener('click', () => switchTab('gemini'))

function updateUI() {
  showFeedback('', '')
  keyInput.value = ''
  keyInput.classList.remove('error')

  const tabHasKey = activeTab === 'gemini' ? hasGeminiKey : hasAnthropicKey
  const tabIsActiveProvider = aiProvider === activeTab

  // Render provider status
  if (tabIsActiveProvider) {
    if (tabHasKey) {
      statusBar.className = `enabled ${activeTab}`
      statusDot.textContent = '●'
      statusText.textContent = `${activeTab === 'gemini' ? 'GEMINI' : 'CLAUDE'} ACTIVE`
      keyLabel.textContent = 'Key verified & saved. AI coaching is running.'
      keyInput.placeholder = 'Paste new key to update'
    } else {
      // Configured as active provider but key was deleted/not set
      statusBar.className = 'disabled'
      statusDot.textContent = '●'
      statusText.textContent = 'AI NOT ACTIVE'
      keyLabel.textContent = 'No API key set.'
      keyInput.placeholder = 'Paste key here'
    }
    activateBtn.classList.add('hidden')
  } else {
    // This tab is inactive (the other provider is running)
    statusBar.className = 'disabled'
    statusDot.textContent = '●'
    statusText.textContent = `${activeTab === 'gemini' ? 'GEMINI' : 'CLAUDE'} INACTIVE`
    
    if (tabHasKey) {
      keyLabel.textContent = `API Key is saved, but ${aiProvider === 'gemini' ? 'Gemini' : 'Claude'} is currently active.`
      activateBtn.classList.remove('hidden')
      keyInput.placeholder = 'Paste new key to update'
    } else {
      keyLabel.textContent = 'No API key saved.'
      activateBtn.classList.add('hidden')
      keyInput.placeholder = 'Paste key here'
    }
  }
}

// ── Activate provider ────────────────────────────────────────────────────────
activateBtn.addEventListener('click', async () => {
  activateBtn.disabled = true
  const res = await window.aiSetup.setProvider(activeTab)
  activateBtn.disabled = false
  
  if (res && res.success) {
    aiProvider = activeTab
    showFeedback(`${activeTab === 'gemini' ? 'Gemini' : 'Claude'} is now your active AI coach!`, 'success')
    updateUI()
  } else {
    showFeedback(res?.error || 'Failed to switch provider', 'error')
  }
})

// ── Save key ──────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  const key = keyInput.value.trim()
  if (!key) {
    showFeedback('Enter your API key first', 'error')
    keyInput.classList.add('error')
    return
  }
  
  // Custom validation per provider
  if (activeTab === 'anthropic' && !key.startsWith('sk-ant-')) {
    showFeedback('Invalid key — must start with sk-ant-', 'error')
    keyInput.classList.add('error')
    return
  }
  if (activeTab === 'gemini' && key.startsWith('sk-ant-')) {
    showFeedback('This looks like a Claude key. Please paste a Gemini key.', 'error')
    keyInput.classList.add('error')
    return
  }

  saveBtn.disabled = true
  saveBtn.textContent = '...'
  const res = await window.aiSetup.saveKey(activeTab, key)
  saveBtn.disabled = false
  saveBtn.textContent = 'SAVE'

  if (res && res.success) {
    showFeedback('Key verified and saved! AI coaching is active.', 'success')
    if (activeTab === 'gemini') {
      hasGeminiKey = true
    } else {
      hasAnthropicKey = true
    }
    aiProvider = activeTab
    updateUI()
  } else {
    const errMsg = res && res.error ? res.error : 'Failed to save key — try again'
    showFeedback(`Error: ${errMsg}`, 'error')
    keyInput.classList.add('error')
  }
})

keyInput.addEventListener('input', () => {
  keyInput.classList.remove('error')
  showFeedback('', '')
})

keyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveBtn.click()
  if (e.key === 'Escape') window.aiSetup.close()
})

function showFeedback(msg, type) {
  feedback.textContent = msg
  feedback.className = type || ''
}

init()

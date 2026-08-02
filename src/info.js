const $ = (id) => document.getElementById(id)

// Close window
$('close-btn').addEventListener('click', () => {
  window.infoWindow.close()
})

// Links
$('btn-yt').addEventListener('click', () => {
  window.infoWindow.openUrl('https://www.youtube.com/@DK_hobby')
})

$('btn-gh').addEventListener('click', () => {
  window.infoWindow.openUrl('https://github.com/dkyk0929/lol-coach-overlay')
})

// Load version
window.infoWindow.getVersion().then((v) => {
  $('version-text').textContent = `v${v}`
}).catch(() => {
  $('version-text').textContent = 'v1.9.8'
})

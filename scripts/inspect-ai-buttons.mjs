import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEMO = join(ROOT, 'demo/data/Zillion_Telecom_Business_Demo.xlsx')
const BASE = process.env.AI_BUTTON_BASE_URL ?? 'http://localhost:5178'
const BROWSER =
  process.env.AI_BUTTON_BROWSER ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      const pending = this.pending.get(message.id)
      if (pending) {
        this.pending.delete(message.id)
        if (message.error) {
          pending.reject(new Error(message.error.message ?? 'CDP error'))
        } else {
          pending.resolve(message.result)
        }
      }
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'evaluate failed')
    }
    return result.result.value
  }
}

async function connectToPage(port) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
        if (page) {
          const ws = new WebSocket(page.webSocketDebuggerUrl)
          await new Promise((resolve, reject) => {
            ws.addEventListener('open', resolve)
            ws.addEventListener('error', () => reject(new Error('CDP websocket failed')))
          })
          return new Cdp(ws)
        }
      }
    } catch {
      await sleep(200)
    }
  }
  throw new Error('Could not connect to browser page DevTools')
}

async function main() {
  const userData = await mkdtemp(join(tmpdir(), 'zillion-ai-cdp-'))
  const port = 9333
  const child = spawn(
    BROWSER,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userData}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  try {
    const cdp = await connectToPage(port)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('DOM.enable')
    await cdp.send('Page.navigate', { url: BASE })
    await cdp.evaluate(`
      new Promise((resolve, reject) => {
        const start = Date.now()
        const tick = () => {
          if (document.querySelector('input[type="file"]')) {
            resolve(true)
            return
          }
          if (Date.now() - start > 20000) {
            reject(new Error('file input not found: ' + document.title + ' ' + location.href + ' ' + (document.body && document.body.innerText || '').slice(0, 200)))
            return
          }
          setTimeout(tick, 200)
        }
        tick()
      })
    `)

    const document = await cdp.send('DOM.getDocument', { depth: 1 })
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: 'input[type="file"]',
    })
    await cdp.send('DOM.setFileInputFiles', { nodeId, files: [DEMO] })

    await cdp.evaluate(`
      new Promise((resolve, reject) => {
        const start = Date.now()
        const tick = () => {
          const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('Analyze Data'))
          if (button && !button.disabled) {
            button.click()
            resolve(true)
            return
          }
          if (Date.now() - start > 15000) {
            reject(new Error('Analyze Data button not ready'))
            return
          }
          setTimeout(tick, 100)
        }
        tick()
      })
    `)

    const waitForSelector = async (selector, timeout = 20000) => {
      return cdp.evaluate(`
        new Promise((resolve, reject) => {
          const start = Date.now()
          const tick = () => {
            if (document.querySelector(${JSON.stringify(selector)})) {
              resolve(true)
              return
            }
            if (Date.now() - start > ${timeout}) {
              reject(new Error('timeout waiting for ${selector}'))
              return
            }
            setTimeout(tick, 100)
          }
          tick()
        })
      `)
    }

    await waitForSelector('[data-ai-action="generate-review"]', 25000)

    const snapshot = () =>
      cdp.evaluate(`(() => {
        const dump = (button) => {
          if (!button) return { present: false }
          const style = getComputedStyle(button)
          const rect = button.getBoundingClientRect()
          const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return {
            present: true,
            text: (button.textContent || '').trim(),
            disabled: button.disabled,
            ariaDisabled: button.getAttribute('aria-disabled'),
            pointerEvents: style.pointerEvents,
            cursor: style.cursor,
            opacity: style.opacity,
            overlayTag: top && top.tagName,
            overlayAiAction: top && (top.getAttribute('data-ai-action') || (top.closest && top.closest('[data-ai-action]') && top.closest('[data-ai-action]').getAttribute('data-ai-action'))),
            parentDisabled: Boolean(button.closest('fieldset[disabled], [inert]')),
            html: button.outerHTML.slice(0, 400),
          }
        }
        const stack = document.querySelector('[data-ai-stack="true"]')
        return {
          stack: stack ? { ...stack.dataset } : null,
          attentionPanel: document.querySelector('[data-ai-panel="attention"]') ? { ...document.querySelector('[data-ai-panel="attention"]').dataset } : null,
          recsPanel: document.querySelector('[data-ai-panel="recommendations"]') ? { ...document.querySelector('[data-ai-panel="recommendations"]').dataset } : null,
          reviewVisible: [...document.querySelectorAll('h2')].some((node) => node.textContent === 'Executive Summary'),
          reviewError: [...document.querySelectorAll('h2')].some((node) => /unavailable|try again/i.test(node.textContent || '')),
          reviewHeadings: [...document.querySelectorAll('h2')].map((node) => (node.textContent || '').trim()),
          attentionHint: [...document.querySelectorAll('[aria-label="Attention Areas"] p')].map((node) => (node.textContent || '').trim()).filter(Boolean),
          recsHint: [...document.querySelectorAll('[aria-label="AI Recommendations"] p')].map((node) => (node.textContent || '').trim()).filter(Boolean),
          attention: dump(document.querySelector('[data-ai-action="identify-attention"]')),
          recs: dump(document.querySelector('[data-ai-action="generate-recommendations"]')),
          review: dump(document.querySelector('[data-ai-action="generate-review"]')),
        }
      })()`)

    const before = await snapshot()

    await cdp.evaluate(`
      const button = document.querySelector('[data-ai-action="generate-review"]')
      if (!button) throw new Error('review button missing')
      button.click()
    `)

    const reviewOutcome = await cdp.evaluate(`
      new Promise((resolve) => {
        const start = Date.now()
        const tick = () => {
          if ([...document.querySelectorAll('h2')].some((node) => node.textContent === 'Executive Summary')) {
            resolve('ready')
            return
          }
          if ([...document.querySelectorAll('button')].some((node) => node.textContent.includes('Try Again'))) {
            resolve('error')
            return
          }
          if (Date.now() - start > 90000) {
            resolve('timeout')
            return
          }
          setTimeout(tick, 250)
        }
        tick()
      })
    `)

    const afterReview = await snapshot()

    let attentionClick = { attempted: false }
    let afterAttention = null
    let recsClick = { attempted: false }
    if (afterReview.attention.present && !afterReview.attention.disabled) {
      const clicked = await cdp.evaluate(`
        new Promise((resolve) => {
          let clicked = false
          const original = console.log
          console.log = (...args) => {
            original.apply(console, args)
            if (String(args[0]).includes('ATTENTION BUTTON CLICKED')) clicked = true
          }
          const button = document.querySelector('[data-ai-action="identify-attention"]')
          button.click()
          setTimeout(() => {
            console.log = original
            resolve({ handlerRan: clicked, disabledAfter: button.disabled })
          }, 50)
        })
      `)
      attentionClick = { attempted: true, ...clicked }
      const attentionOutcome = await cdp.evaluate(`
        new Promise((resolve) => {
          const start = Date.now()
          const tick = () => {
            const panel = document.querySelector('[data-ai-panel="attention"]')
            const status = panel && panel.getAttribute('data-ai-status')
            if (status === 'ready' || document.querySelector('[data-ai-action="regenerate-attention"]')) {
              resolve('ready')
              return
            }
            if ([...document.querySelectorAll('button')].some((node) => node.textContent.includes('Try Again'))) {
              resolve('error')
              return
            }
            if (Date.now() - start > 90000) {
              resolve('timeout')
              return
            }
            setTimeout(tick, 250)
          }
          tick()
        })
      `)
      afterAttention = await snapshot()
      afterAttention.attentionOutcome = attentionOutcome
      if (afterAttention.recs.present && !afterAttention.recs.disabled) {
        const recClicked = await cdp.evaluate(`
          new Promise((resolve) => {
            let clicked = false
            const original = console.log
            console.log = (...args) => {
              original.apply(console, args)
              if (String(args[0]).includes('RECOMMENDATIONS BUTTON CLICKED')) clicked = true
            }
            const button = document.querySelector('[data-ai-action="generate-recommendations"]')
            button.click()
            setTimeout(() => {
              console.log = original
              resolve({ handlerRan: clicked, disabledAfter: button.disabled })
            }, 50)
          })
        `)
        recsClick = { attempted: true, ...recClicked }
      } else {
        recsClick = { attempted: false, recsDisabled: afterAttention.recs.disabled }
      }
    } else if (afterReview.attention.present) {
      const forced = await cdp.evaluate(`
        new Promise((resolve) => {
          let clicked = false
          const original = console.log
          console.log = (...args) => {
            original.apply(console, args)
            if (String(args[0]).includes('ATTENTION BUTTON CLICKED')) clicked = true
          }
          const button = document.querySelector('[data-ai-action="identify-attention"]')
          button.click()
          setTimeout(() => {
            console.log = original
            resolve({ handlerRan: clicked, disabled: button.disabled })
          }, 50)
        })
      `)
      attentionClick = { attempted: true, blockedByDisabled: true, ...forced }
    }

    const regenerate = await cdp.evaluate(`(() => {
      const dump = (selector) => {
        const button = document.querySelector(selector)
        return button ? { present: true, disabled: button.disabled, text: (button.textContent || '').trim() } : { present: false }
      }
      return {
        review: dump('[data-ai-action="regenerate-review"]'),
        attention: dump('[data-ai-action="regenerate-attention"]'),
        recs: dump('[data-ai-action="regenerate-recommendations"]'),
      }
    })()`)

    console.log(JSON.stringify({ reviewOutcome, before, afterReview, attentionClick, afterAttention, recsClick, regenerate }, null, 2))
    cdp.ws.close()
    if (reviewOutcome !== 'ready') process.exitCode = 2
    else if (afterReview.attention.disabled) process.exitCode = 3
    else if (afterAttention && afterAttention.recs.disabled) process.exitCode = 4
  } finally {
    child.kill()
    await rm(userData, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

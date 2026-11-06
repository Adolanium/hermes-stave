// Stave — describe a piece of music and Hermes writes it as sheet music. A Desktop page (route, sidebar
// row, palette command); Hermes is reached through llm.oneshot, nothing runs in the gateway.
import { host, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'
import { StavePage } from './ui/page.jsx'

const PATH = '/stave'

export default {
  id: 'stave',
  name: 'Stave',
  register(ctx) {
    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        title: 'Stave',
        data: { path: PATH },
        render: () => <StavePage storage={ctx.storage} />
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: PATH, label: 'Stave', codicon: 'unmute' }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'stave.open',
          label: 'Open Stave',
          keywords: ['music', 'song', 'compose', 'sheet music', 'notes', 'melody', 'score', 'abc'],
          run: () => host.navigate(PATH)
        }
      }
    ])
  }
}

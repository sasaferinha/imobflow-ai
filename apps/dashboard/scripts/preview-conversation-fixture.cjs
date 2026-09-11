// Read-only visual fixture: fictional data, no hydration and no outgoing calls.
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  http = require("node:http"),
  ts = require("typescript");
const { createElement } = require("react"),
  { renderToStaticMarkup } = require("react-dom/server");
const base = path.join(__dirname, "..");
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path.join(base, file), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      module: mod,
      exports: mod.exports,
      require: (n) =>
        n.startsWith("@/lib/")
          ? load(n.replace("@/", "") + ".ts")
          : n.startsWith("./")
            ? load(path.posix.join(path.posix.dirname(file), n + ".tsx"))
            : require(n),
      Date,
      Intl,
      Map,
    },
  );
  cache.set(file, mod.exports);
  return mod.exports;
}
const Component = load("app/conversation-center.tsx").default;
const demo = load("lib/demo-conversations.ts");
const lead = {
  id: "00000000-0000-4000-8000-000000000100",
  name: "Cliente de Teste",
  phone: "5535000000000",
  email: null,
  goal: "Não informado",
  propertyType: "Não informado",
  region: "Não informado",
  budget: "Não informado",
  details: null,
  summary: "",
  score: 0,
  scoreDefined: false,
  temperature: "Indefinido",
  source: "WhatsApp",
  assignedTo: null,
  lifecycleStatus: "Novo",
  lastContactAt: null,
  createdAt: "2026-09-11T12:00:00Z",
};
const state = demo.demoConversationReducer(demo.createLiveConversationState(), {
  type: "hydrate",
  contacts: [
    {
      id: "lead-" + lead.id,
      messages: [
        {
          id: "in",
          side: "incoming",
          text: "Oi, quero comprar uma casa.",
          time: "09:00",
          sender: "Cliente",
        },
        {
          id: "out",
          side: "outgoing",
          text: "Em qual cidade você está procurando?",
          time: "09:00",
          sender: "Automático",
          deliveryStatus: "failed",
          deliveryError:
            "A Meta restringiu o envio para o país do destinatário.",
        },
      ],
    },
  ],
});
const markup = renderToStaticMarkup(
  createElement(Component, {
    state,
    dispatch() {},
    notify() {},
    openAgenda() {},
    claimLead: async () => {},
    persistMessage: async () => {},
    refreshProperties: async () => {},
    currentBrokerName: "Corretor",
    leads: [lead],
    properties: [],
  }),
);
const css = [
  "globals.css",
  "admin-layout.css",
  "native-theme.css",
  "conversation-pilot.css",
]
  .map((f) => fs.readFileSync(path.join(base, "app", f), "utf8"))
  .join("\n");
http
  .createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; img-src data:",
    );
    res.end(
      req.url === "/mobile"
        ? '<iframe title="Celular 390px" src="/" style="width:390px;height:900px;border:1px solid #aaa"></iframe>'
        : `<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><main style="padding:16px"><p>Prévia local · dados fictícios · controles sem envio</p>${markup}</main></body></html>`,
    );
  })
  .listen(4318, "127.0.0.1", () =>
    console.log("Fixture: http://127.0.0.1:4318 — /mobile for 390px"),
  );

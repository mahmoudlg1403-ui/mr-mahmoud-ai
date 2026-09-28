import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import serverless from 'serverless-http';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '30mb' }));

app.use((req, res, next) => {
  req.url =
    req.url.replace(/^\/\.netlify\/functions\/api/, '') || '/';
  next();
});

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR =
  process.env.DATA_DIR || '/tmp/mr-mahmoud-data';

const files = {
  memory: path.join(DATA_DIR, 'memory.json'),
  tasks: path.join(DATA_DIR, 'tasks.json'),
  history: path.join(DATA_DIR, 'history.json'),
  projects: path.join(DATA_DIR, 'projects.json')
};

const MAX_FILE_BYTES = 15 * 1024 * 1024;

const system = `
You are محمود AI (Mr. Mahmoud), the user's personal smart assistant.

IMPORTANT IDENTITY RULES:
- Your name is ALWAYS "محمود" or "محمود AI".
- NEVER call yourself "مهدی", "مهدی AI", "محمد", "ChatGPT", "Claude", or any other name.
- If the user asks "اسمت چیه؟", answer: "من محمود هستم، دستیار شخصی هوشمند شما."
- You are a Persian-speaking personal assistant.
- Prefer natural, clear and helpful Persian unless the user asks for another language.
- Speak directly and confidently, without unnecessary explanations.
- Remember that your role is to help the user plan, organize, analyze, research and perform available tasks.

CAPABILITIES:
- Answer questions and have natural conversations.
- Help plan and organize tasks.
- Work with memory when relevant.
- Create and manage tasks through available endpoints.
- Create and manage projects through available endpoints.
- Analyze information and produce practical plans.
- Use Agent capabilities when available.
- Never claim an external action was completed unless a real tool endpoint actually performed it.
- Ask for approval before consequential external actions.
- Be practical, concise, accurate and transparent.

PERSONALITY:
- Friendly, intelligent, calm and practical.
- Do not repeatedly introduce yourself.
- Do not say you are another assistant or another person's AI.
- When the user says "محمود", understand that they are talking to you.
- When introducing yourself, use the name "محمود AI".

Use relevant memory when available.
`;

async function read(file, fallback = []) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function write(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify(data, null, 2)
  );
}

function id() {
  return crypto.randomUUID();
}

async function memText() {
  const m = await read(files.memory, []);

  return m
    .slice(0, 80)
    .map(x => `- ${x.text}`)
    .join('\n');
}

function cleanJson(s) {
  return String(s)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}


/* =========================
   OPENAI
========================= */

async function openai(messages, { web = false, json = false } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const mem = await memText();

  const body = {
    model:
      process.env.OPENAI_MODEL ||
      'gpt-5.6-luna',

    input: [
      {
        role: 'system',
        content: system
      },

      ...(mem
        ? [
            {
              role: 'system',
              content: `Relevant memory:\n${mem}`
            }
          ]
        : []),

      ...messages
    ]
  };

  if (web) {
    body.tools = [
      {
        type: 'web_search_preview'
      }
    ];
  }

  if (json) {
    body.text = {
      format: {
        type: 'json_object'
      }
    };
  }

  const r = await fetch(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization:
          `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  const j = await r.json();

  if (!r.ok) {
    throw new Error(
      j.error?.message || 'OpenAI error'
    );
  }

  return j.output_text || '';
}


/* =========================
   GROQ
========================= */

async function groq(messages, { json = false } = {}) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error(
      'GROQ_API_KEY is not configured'
    );
  }

  const mem = await memText();

  const msgs = [
    {
      role: 'system',
      content:
        system +
        (mem
          ? `\nRelevant memory:\n${mem}`
          : '')
    },
    ...messages
  ];

  const body = {
    model:
      process.env.GROQ_MODEL ||
      'openai/gpt-oss-120b',

    messages: msgs,

    temperature: 0.7,

    max_completion_tokens: 2048
  };

  if (json) {
    body.response_format = {
      type: 'json_object'
    };
  }

  const r = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',

      headers: {
        Authorization:
          `Bearer ${process.env.GROQ_API_KEY}`,

        'Content-Type':
          'application/json'
      },

      body: JSON.stringify(body)
    }
  );

  const j = await r.json();

  if (!r.ok) {
    throw new Error(
      j.error?.message || 'Groq error'
    );
  }

  return (
    j.choices?.[0]?.message?.content ||
    ''
  );
}


/* =========================
   CLAUDE
========================= */

async function claude(messages, { json = false } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not configured'
    );
  }

  const mem = await memText();

  const r = await fetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',

      headers: {
        'x-api-key':
          process.env.ANTHROPIC_API_KEY,

        'anthropic-version':
          '2023-06-01',

        'content-type':
          'application/json'
      },

      body: JSON.stringify({
        model:
          process.env.CLAUDE_MODEL ||
          'claude-sonnet-4-5',

        max_tokens: 8192,

        system:
          system +
          (mem
            ? `\nRelevant memory:\n${mem}`
            : ''),

        messages
      })
    }
  );

  const j = await r.json();

  if (!r.ok) {
    throw new Error(
      j.error?.message || 'Claude error'
    );
  }

  return (j.content || [])
    .filter(x => x.type === 'text')
    .map(x => x.text)
    .join('');
}


/* =========================
   PROVIDER SELECTOR
========================= */

async function ask(
  provider,
  messages,
  opts = {}
) {
  let p = provider || 'auto';

  if (p === 'auto') {
    if (process.env.GROQ_API_KEY) {
      p = 'groq';
    } else if (process.env.OPENAI_API_KEY) {
      p = 'openai';
    } else if (process.env.ANTHROPIC_API_KEY) {
      p = 'claude';
    } else {
      p = 'none';
    }
  }

  if (p === 'none') {
    throw new Error(
      'No AI provider configured'
    );
  }

  let text = '';

  if (p === 'groq') {
    text = await groq(messages, opts);
  } else if (p === 'openai') {
    text = await openai(messages, opts);
  } else if (p === 'claude') {
    text = await claude(messages, opts);
  } else {
    throw new Error(
      `Unknown provider: ${p}`
    );
  }

  return {
    provider: p,
    text
  };
}


/* =========================
   HEALTH
========================= */

app.get('/health', (q, s) => {
  s.json({
    ok: true,
    version: '8.0',

    provider:
      process.env.GROQ_API_KEY
        ? 'groq'
        : process.env.OPENAI_API_KEY
          ? 'openai'
          : process.env.ANTHROPIC_API_KEY
            ? 'claude'
            : 'none',

    features: [
      'chat',
      'memory',
      'agent',
      'web',
      'tasks',
      'projects',
      'history',
      'file-analysis',
      'approval',
      'tool-execution'
    ]
  });
});


/* =========================
   CHAT
========================= */

app.post(
  '/api/chat',
  async (q, s) => {
    try {
      const messages =
        (q.body.messages || [])
          .slice(-30)
          .map(x => ({
            role:
              x.role === 'assistant'
                ? 'assistant'
                : 'user',

            content:
              String(x.content || '')
          }));

      const r = await ask(
        q.body.provider,
        messages,
        {
          web: Boolean(q.body.web)
        }
      );

      const h =
        await read(files.history, []);

      h.unshift({
        id: id(),

        createdAt:
          new Date().toISOString(),

        provider:
          r.provider,

        messages: [
          ...messages,
          {
            role: 'assistant',
            content: r.text
          }
        ]
      });

      try {
        await write(
          files.history,
          h.slice(0, 100)
        );
      } catch {}

      s.json(r);

    } catch (e) {
      s.status(500).json({
        error: e.message
      });
    }
  }
);


/* =========================
   HISTORY
========================= */

app.get(
  '/api/history',
  async (q, s) => {
    s.json({
      items:
        await read(
          files.history,
          []
        )
    });
  }
);

app.delete(
  '/api/history',
  async (q, s) => {
    await write(
      files.history,
      []
    );

    s.json({
      ok: true
    });
  }
);


/* =========================
   MEMORY
========================= */

app.get(
  '/api/memory',
  async (q, s) => {
    s.json({
      items:
        await read(
          files.memory,
          []
        )
    });
  }
);

app.post(
  '/api/memory',
  async (q, s) => {
    const text =
      String(
        q.body.text || ''
      ).trim();

    if (!text) {
      return s.status(400).json({
        error: 'text required'
      });
    }

    const a =
      await read(
        files.memory,
        []
      );

    const x = {
      id: id(),
      text,
      createdAt:
        new Date().toISOString(),
      tags:
        q.body.tags || []
    };

    a.unshift(x);

    await write(
      files.memory,
      a.slice(0, 1000)
    );

    s.json(x);
  }
);

app.delete(
  '/api/memory/:id',
  async (q, s) => {
    await write(
      files.memory,
      (
        await read(
          files.memory,
          []
        )
      ).filter(
        x => x.id !== q.params.id
      )
    );

    s.json({
      ok: true
    });
  }
);


/* =========================
   TASKS
========================= */

app.get(
  '/api/tasks',
  async (q, s) => {
    s.json({
      items:
        await read(
          files.tasks,
          []
        )
    });
  }
);

app.post(
  '/api/tasks',
  async (q, s) => {
    const title =
      String(
        q.body.title || ''
      ).trim();

    if (!title) {
      return s.status(400).json({
        error: 'title required'
      });
    }

    const a =
      await read(
        files.tasks,
        []
      );

    const x = {
      id: id(),
      title,

      notes:
        String(
          q.body.notes || ''
        ),

      dueAt:
        q.body.dueAt || null,

      priority:
        q.body.priority ||
        'normal',

      done: false,

      createdAt:
        new Date().toISOString()
    };

    a.unshift(x);

    await write(
      files.tasks,
      a
    );

    s.json(x);
  }
);

app.patch(
  '/api/tasks/:id',
  async (q, s) => {
    const a =
      await read(
        files.tasks,
        []
      );

    const x =
      a.find(
        v => v.id === q.params.id
      );

    if (!x) {
      return s.status(404).json({
        error: 'not found'
      });
    }

    Object.assign(
      x,
      Object.fromEntries(
        Object.entries(q.body)
          .filter(
            ([k]) =>
              [
                'title',
                'notes',
                'dueAt',
                'priority',
                'done'
              ].includes(k)
          )
      )
    );

    await write(
      files.tasks,
      a
    );

    s.json(x);
  }
);

app.delete(
  '/api/tasks/:id',
  async (q, s) => {
    await write(
      files.tasks,
      (
        await read(
          files.tasks,
          []
        )
      ).filter(
        x => x.id !== q.params.id
      )
    );

    s.json({
      ok: true
    });
  }
);


/* =========================
   PROJECTS
========================= */

app.get(
  '/api/projects',
  async (q, s) => {
    s.json({
      items:
        await read(
          files.projects,
          []
        )
    });
  }
);

app.post(
  '/api/projects',
  async (q, s) => {
    const name =
      String(
        q.body.name || ''
      ).trim();

    if (!name) {
      return s.status(400).json({
        error: 'name required'
      });
    }

    const a =
      await read(
        files.projects,
        []
      );

    const x = {
      id: id(),
      name,

      description:
        String(
          q.body.description || ''
        ),

      status: 'active',

      createdAt:
        new Date().toISOString()
    };

    a.unshift(x);

    await write(
      files.projects,
      a
    );

    s.json(x);
  }
);


/* =========================
   AGENT PLAN
========================= */

app.post(
  '/api/agent',
  async (q, s) => {
    try {
      const goal =
        String(
          q.body.goal || ''
        ).trim();

      if (!goal) {
        return s.status(400).json({
          error: 'goal required'
        });
      }

      const prompt = `
هدف کاربر: ${goal}

یک برنامه اجرایی دقیق بساز.

خروجی فقط JSON باشد:

{
  "summary":"",
  "steps":[
    {
      "id":"1",
      "title":"",
      "action":"",
      "type":"think|web|task|memory|calendar|approval",
      "status":"pending",
      "requiresApproval":false
    }
  ],
  "deliverable":"",
  "risks":[]
}

کارهای حساس بیرونی را
requiresApproval=true
قرار بده.
`;

      const r =
        await ask(
          q.body.provider,
          [
            {
              role: 'user',
              content: prompt
            }
          ],
          {
            json: true
          }
        );

      let plan;

      try {
        plan =
          JSON.parse(
            cleanJson(r.text)
          );
      } catch {
        plan = {
          summary:
            'برنامه تولید شد',

          steps: [
            {
              id: '1',
              title: 'بررسی',
              action: r.text,
              type: 'think',
              status: 'pending',
              requiresApproval: false
            }
          ],

          deliverable: '',
          risks: []
        };
      }

      const project = {
        id: id(),
        goal,
        plan,
        provider: r.provider,
        createdAt:
          new Date().toISOString()
      };

      const ps =
        await read(
          files.projects,
          []
        );

      ps.unshift(project);

      await write(
        files.projects,
        ps.slice(0, 200)
      );

      s.json(project);

    } catch (e) {
      s.status(500).json({
        error: e.message
      });
    }
  }
);


/* =========================
   SUMMARIZE
========================= */

app.post(
  '/api/summarize',
  async (q, s) => {
    try {
      const text =
        String(
          q.body.text || ''
        );

      if (!text) {
        return s.status(400).json({
          error: 'text required'
        });
      }

      s.json(
        await ask(
          q.body.provider,
          [
            {
              role: 'user',
              content:
                `این متن را خلاصه کن و نکات عملی/اقدامات بعدی را جدا کن:\n${text}`
            }
          ]
        )
      );

    } catch (e) {
      s.status(500).json({
        error: e.message
      });
    }
  }
);


/* =========================
   AGENT EXECUTE
========================= */

app.post(
  '/api/agent/execute',
  async (q, s) => {
    try {
      const projectId =
        String(
          q.body.projectId || ''
        );

      const stepId =
        String(
          q.body.stepId || ''
        );

      const approved =
        Boolean(
          q.body.approved
        );

      const ps =
        await read(
          files.projects,
          []
        );

      const project =
        ps.find(
          x =>
            x.id === projectId
        );

      if (!project) {
        return s.status(404).json({
          error:
            'project not found'
        });
      }

      const step =
        (
          project.plan?.steps ||
          []
        ).find(
          x =>
            String(x.id) ===
            stepId
        );

      if (!step) {
        return s.status(404).json({
          error:
            'step not found'
        });
      }

      if (
        step.requiresApproval &&
        !approved
      ) {
        return s.json({
          status:
            'approval_required',

          message:
            'این مرحله قبل از اجرا نیاز به تأیید شما دارد.',

          step
        });
      }

      let result = '';

      if (
        step.type === 'task'
      ) {
        const a =
          await read(
            files.tasks,
            []
          );

        const x = {
          id: id(),
          title:
            step.title ||
            step.action,

          notes:
            step.action || '',

          dueAt: null,

          priority:
            'normal',

          done: false,

          createdAt:
            new Date().toISOString()
        };

        a.unshift(x);

        await write(
          files.tasks,
          a
        );

        result =
          `کار ایجاد شد: ${x.title}`;

      } else if (
        step.type === 'memory'
      ) {
        const a =
          await read(
            files.memory,
            []
          );

        const x = {
          id: id(),

          text:
            step.action ||
            step.title,

          createdAt:
            new Date().toISOString(),

          tags: ['agent']
        };

        a.unshift(x);

        await write(
          files.memory,
          a
        );

        result =
          'در حافظه ذخیره شد.';

      } else if (
        step.type === 'calendar'
      ) {
        result =
          'پیشنهاد تقویم آماده شد؛ ایجاد رویداد واقعی نیاز به اتصال تقویم دارد.';

      } else if (
        step.type === 'approval'
      ) {
        result =
          'تأیید دریافت شد.';

      } else {
        result =
          step.action ||
          step.title ||
          'مرحله بررسی شد.';
      }

      step.status = 'done';

      step.result = result;

      step.completedAt =
        new Date().toISOString();

      await write(
        files.projects,
        ps
      );

      s.json({
        status: 'done',
        result,
        step
      });

    } catch (e) {
      s.status(500).json({
        error: e.message
      });
    }
  }
);


/* =========================
   APPROVALS
========================= */

app.get(
  '/api/approvals',
  async (q, s) => {
    const ps =
      await read(
        files.projects,
        []
      );

    const items = [];

    for (const p of ps) {
      const st =
        p.runtime?.waitingFor;

      if (st != null) {
        const step =
          (
            p.plan?.steps ||
            []
          ).find(
            x =>
              String(x.id) ===
              String(st)
          );

        if (step) {
          items.push({
            projectId: p.id,
            goal: p.goal,
            step
          });
        }
      }
    }

    s.json({
      items
    });
  }
);


/* =========================
   AGENT CANCEL
========================= */

app.post(
  '/api/agent/cancel',
  async (q, s) => {
    const projectId =
      String(
        q.body.projectId || ''
      );

    const ps =
      await read(
        files.projects,
        []
      );

    const p =
      ps.find(
        x =>
          x.id === projectId
      );

    if (!p) {
      return s.status(404).json({
        error:
          'project not found'
      });
    }

    p.runtime =
      p.runtime || {};

    p.runtime.status =
      'cancelled';

    p.runtime.cancelledAt =
      new Date().toISOString();

    await write(
      files.projects,
      ps
    );

    s.json({
      status: 'cancelled',
      project: p
    });
  }
);


/* =========================
   AGENT RUN
========================= */

app.post(
  '/api/agent/run',
  async (q, s) => {
    try {
      const projectId =
        String(
          q.body.projectId || ''
        );

      const approvedStepId =
        String(
          q.body.approvedStepId || ''
        );

      const maxSteps =
        Math.min(
          Math.max(
            Number(
              q.body.maxSteps || 12
            ),
            1
          ),
          20
        );

      const ps =
        await read(
          files.projects,
          []
        );

      const project =
        ps.find(
          x =>
            x.id === projectId
        );

      if (!project) {
        return s.status(404).json({
          error:
            'project not found'
        });
      }

      project.runtime =
        project.runtime || {
          status: 'running',
          runs: 0,
          log: []
        };

      project.runtime.status =
        'running';

      project.runtime.runs++;

      let executed = 0;

      while (
        executed < maxSteps
      ) {
        const steps =
          project.plan?.steps ||
          [];

        const step =
          steps.find(
            x =>
              x.status !== 'done' &&
              x.status !== 'failed'
          );

        if (!step) {
          project.runtime.status =
            'completed';

          await write(
            files.projects,
            ps
          );

          return s.json({
            status:
              'completed',
            project
          });
        }

        if (
          step.requiresApproval &&
          approvedStepId !==
            String(step.id)
        ) {
          project.runtime.status =
            'waiting_approval';

          project.runtime.waitingFor =
            step.id;

          await write(
            files.projects,
            ps
          );

          return s.json({
            status:
              'approval_required',
            step,
            project
          });
        }

        step.status =
          'running';

        await write(
          files.projects,
          ps
        );

        try {
          let result = '';

          if (
            step.type === 'task'
          ) {
            const a =
              await read(
                files.tasks,
                []
              );

            const x = {
              id: id(),

              title:
                step.title ||
                step.action,

              notes:
                step.action || '',

              dueAt: null,

              priority:
                step.priority ||
                'normal',

              done: false,

              createdAt:
                new Date().toISOString()
            };

            a.unshift(x);

            await write(
              files.tasks,
              a
            );

            result =
              `کار ایجاد شد: ${x.title}`;

          } else if (
            step.type === 'memory'
          ) {
            const a =
              await read(
                files.memory,
                []
              );

            const x = {
              id: id(),

              text:
                step.action ||
                step.title,

              createdAt:
                new Date().toISOString(),

              tags: ['agent']
            };

            a.unshift(x);

            await write(
              files.memory,
              a
            );

            result =
              'در حافظه ذخیره شد.';

          } else if (
            step.type === 'calendar'
          ) {
            result =
              'رویداد تقویم آماده است؛ برای ایجاد واقعی باید اتصال تقویم انجام شود.';

          } else if (
            step.type === 'approval'
          ) {
            result =
              'تأیید دریافت شد.';

          } else {
            result =
              (
                await ask(
                  q.body.provider ||
                    'auto',
                  [
                    {
                      role: 'user',
                      content:
                        `این مرحله را تحلیل کن و نتیجه عملی بده:\n${step.action || step.title}`
                    }
                  ]
                )
              ).text;
          }

          step.status =
            'done';

          step.result =
            result;

          step.completedAt =
            new Date().toISOString();

          project.runtime.log.push({
            stepId:
              step.id,

            title:
              step.title,

            status:
              'done',

            at:
              step.completedAt
          });

        } catch (e) {
          step.status =
            'failed';

          step.result =
            e.message;

          project.runtime.log.push({
            stepId:
              step.id,

            title:
              step.title,

            status:
              'failed',

            error:
              e.message,

            at:
              new Date().toISOString()
          });

          project.runtime.status =
            'failed';

          await write(
            files.projects,
            ps
          );

          return s.status(500).json({
            status:
              'failed',

            error:
              e.message,

            project
          });
        }

        executed++;

        await write(
          files.projects,
          ps
        );
      }

      project.runtime.status =
        'paused';

      await write(
        files.projects,
        ps
      );

      s.json({
        status:
          'paused',

        executed,

        project
      });

    } catch (e) {
      s.status(500).json({
        error: e.message
      });
    }
  }
);


/* =========================
   FILE ANALYSIS
========================= */

app.post(
  '/api/analyze-file',
  async (q, s) => {
    try {
      const name =
        String(
          q.body.name ||
          'file'
        );

      const mime =
        String(
          q.body.mime ||
          'application/octet-stream'
        );

      const data =
        String(
          q.body.data || ''
        );

      if (!data) {
        return s.status(400).json({
          error:
            'file data required'
        });
      }

      const buf =
        Buffer.from(
          data,
          'base64'
        );

      if (
        buf.length >
        MAX_FILE_BYTES
      ) {
        return s.status(413).json({
          error:
            'file too large (max 15MB)'
        });
      }

      const prompt =
        'فایل پیوست را تحلیل کن. پاسخ فارسی و کاربردی باشد. خلاصه، نکات مهم، خطاها/ریسک‌ها و اقدامات بعدی را جدا کن.';

      if (
        /^text\//.test(mime) ||
        /json|csv|xml|javascript|kotlin|markdown/.test(mime) ||
        /\.(txt|md|csv|json|xml|js|kt|log)$/i.test(name)
      ) {
        const text =
          buf
            .toString('utf8')
            .slice(0, 120000);

        return s.json(
          await ask(
            q.body.provider,
            [
              {
                role: 'user',
                content:
                  `${prompt}\nنام فایل: ${name}\nمحتوا:\n${text}`
              }
            ]
          )
        );
      }

      if (
        /^image\//.test(mime)
      ) {
        if (
          !process.env.OPENAI_API_KEY
        ) {
          return s.status(400).json({
            error:
              'Image analysis requires OPENAI_API_KEY'
          });
        }

        const r =
          await openai([
            {
              role: 'user',

              content: [
                {
                  type:
                    'input_text',

                  text:
                    prompt
                },

                {
                  type:
                    'input_image',

                  image_url:
                    `data:${mime};base64,${data}`
                }
              ]
            }
          ]);

        return s.json({
          provider:
            'openai',

          text: r
        });
      }

      if (
        mime ===
        'application/pdf'
      ) {
        if (
          !process.env.OPENAI_API_KEY
        ) {
          return s.status(400).json({
            error:
              'PDF analysis requires OPENAI_API_KEY'
          });
        }

        const r =
          await openai([
            {
              role: 'user',

              content: [
                {
                  type:
                    'input_text',

                  text:
                    prompt
                },

                {
                  type:
                    'input_file',

                  filename:
                    name,

                  file_data:
                    `data:application/pdf;base64,${data}`
                }
              ]
            }
          ]);

        return s.json({
          provider:
            'openai',

          text: r
        });
      }

      return s.json(
        await ask(
          q.body.provider,
          [
            {
              role: 'user',

              content:
                `${prompt}\nفایل ${name} با نوع ${mime} دریافت شد، اما استخراج مستقیم این نوع فایل فعال نیست. راهکار مناسب برای پردازش آن را توضیح بده.`
            }
          ]
        )
      );

    } catch (e) {
      s.status(500).json({
        error: e.message
      });
    }
  }
);


/* =========================
   SERVERLESS
========================= */

export const handler =
  serverless(app);

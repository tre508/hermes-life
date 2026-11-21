#!/usr/bin/env python3
"""Apply HL-CHAT-002 to a current Hermes Life checkout, transactionally.
Usage: python3 install.py --repo /home/gayzer/Apps/hermes-life
       python3 install.py --repo ... --check
Does not restart services, install dependencies, edit secrets, or touch user DB files.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parent


def replace_once(source: str, old: str, new: str, location: str) -> str:
    n = source.count(old)
    if n != 1:
        raise RuntimeError(f'{location}: expected one insertion anchor; found {n}; checkout differs from audited main')
    return source.replace(old, new, 1)


def patch_chat(src: str) -> str:
    name = 'frontend/src/hermes-chat.ts'
    src = replace_once(src, "import './hermes-chat.css';", "import './hermes-chat.css';\nimport './chat-upgrade.css';\nimport { renderHermesMarkdown } from './chat-markdown';", name)
    src = replace_once(src, "const body=document.createElement('div');body.className='hc-body';body.textContent=content;", "const body=document.createElement('div');body.className='hc-body';if(role==='assistant')renderHermesMarkdown(body, content);else body.textContent=content;", name)
    src = replace_once(src, "navigator.clipboard.writeText(body.textContent||'')", "navigator.clipboard.writeText(content)", name)
    src = replace_once(src, "liveText+=delta;liveBubble.textContent=liveText;", "liveText+=delta;renderHermesMarkdown(liveBubble,liveText);", name)
    src = replace_once(src, "const panel=el('hc-panel'),messages=el('hc-messages'),feedback=el('hc-feedback');", "const panel=el('hc-panel'),messages=el('hc-messages'),feedback=el('hc-feedback');\n" + CHAT_CONTROLS, name)
    src = replace_once(src, "body:JSON.stringify({prompt,conversation_id:conversationId||null,...(pendingRevision?", "body:JSON.stringify({prompt,conversation_id:conversationId||null,...chatModelSelection(),...(pendingRevision?", name)
    src = replace_once(src, "el('hc-toggle').onclick=()=>", "void initializeChatModels();\nel('hc-toggle').onclick=()=>", name)
    src = replace_once(src, "if(!running){activeTask='';await renderFinished();}", "if(!running){const finishedId=activeTask;activeTask='';await renderFinished();void refreshChatUsage(finishedId);}", name)
    src = replace_once(src, "activeTask=t.id;activeState=t.state;box.value='';", "activeTask=t.id;activeState=t.state;void refreshChatUsage(t.id);box.value='';", name)
    src = replace_once(src, "if(d.prefill){const box=", "void refreshChatUsage(d.task_id || '');\n    if(d.prefill){const box=", name)
    return src


CHAT_CONTROLS = r'''
// HL-CHAT-002: provider/model choice is a per-turn override, not a global worker mutation.
const modelBar=document.createElement('div'); modelBar.id='hc-model-controls';
modelBar.innerHTML=`<label>Provider <select id="hc-provider" aria-label="Chat provider"><option value="">Default</option></select></label>
<label>Model <select id="hc-model" aria-label="Chat model"><option value="">Worker default</option></select></label>
<span class="hc-metric" id="hc-context-label" title="Last verified input tokens / configured model context">Context: unavailable</span>
<progress id="hc-context-bar" max="100" value="0" hidden></progress>
<span class="hc-metric" id="hc-cost-label">Cost: unavailable</span>
<span class="hc-metric" id="hc-balance-label">Balance: unavailable</span>`;
panel.querySelector('.hc-head')?.after(modelBar);
type ChatModel={provider:string;model:string;label:string;context_window:number|null};
let allowedChatModels:ChatModel[]=[];
const chatProvider=()=>el('hc-provider') as HTMLSelectElement;
const chatModel=()=>el('hc-model') as HTMLSelectElement;
function chatModelSelection():{provider?:string;model?:string}{
 const provider=chatProvider().value,model=chatModel().value;
 return provider&&model?{provider,model}:{};
}
function refreshModelChoices(){
 const provider=chatProvider().value,previous=chatModel().value;
 chatModel().replaceChildren();
 const def=document.createElement('option');def.value='';def.textContent='Worker default';chatModel().append(def);
 for(const choice of allowedChatModels.filter(x=>x.provider===provider)){
   const option=document.createElement('option');option.value=choice.model;option.textContent=choice.label;chatModel().append(option);
 }
 if([...chatModel().options].some(x=>x.value===previous))chatModel().value=previous;
 chatModel().disabled=!provider;
 void refreshChatBalance();
}
async function initializeChatModels(){
 try{
   const data=await request<{models:ChatModel[]}>('/api/chat/models');
   allowedChatModels=data.models||[];
   const providers=[...new Set(allowedChatModels.map(x=>x.provider))];
   const savedProvider=localStorage.getItem('hl-chat-provider')||'';
   const savedModel=localStorage.getItem('hl-chat-model')||'';
   for(const provider of providers){const option=document.createElement('option');option.value=provider;option.textContent=provider;chatProvider().append(option);}
   if(providers.includes(savedProvider))chatProvider().value=savedProvider;
   refreshModelChoices();
   if([...chatModel().options].some(x=>x.value===savedModel))chatModel().value=savedModel;
   chatProvider().onchange=()=>{localStorage.setItem('hl-chat-provider',chatProvider().value);localStorage.removeItem('hl-chat-model');refreshModelChoices();};
   chatModel().onchange=()=>{localStorage.setItem('hl-chat-model',chatModel().value);void refreshChatBalance();};
 }catch(err){el('hc-context-label').textContent='Model catalog unavailable';}
}
async function refreshChatUsage(taskId:string){
 const context=el('hc-context-label'),cost=el('hc-cost-label'),progress=el('hc-context-bar') as HTMLProgressElement;
 context.textContent='Context: unavailable';cost.textContent='Cost: unavailable';progress.hidden=true;
 if(!taskId)return;
 try{
   const record=await request<{model?:string;provider?:string;context_window?:number;input_tokens?:number;output_tokens?:number;estimated_cost_usd?:number}>(`/api/chat/usage/${encodeURIComponent(taskId)}`);
   if(typeof record.input_tokens==='number'&&typeof record.context_window==='number'&&record.context_window>0){
      const ratio=100*record.input_tokens/record.context_window;
      context.textContent=`Context ${record.input_tokens.toLocaleString()} / ${record.context_window.toLocaleString()} · ${ratio.toFixed(0)}% (last request)`;
      progress.value=Math.min(100,ratio);progress.hidden=false;
   }
   if(typeof record.estimated_cost_usd==='number')cost.textContent=`Last task: $${record.estimated_cost_usd.toFixed(4)} (estimated)`;
 }catch { /* model override may not have been selected; telemetry unavailable */ }
}
async function refreshChatBalance(){
 const host=el('hc-balance-label'); host.textContent='Balance: unavailable';
 const provider=chatProvider().value;
 if(!provider)return;
 try{
   const result=await request<{available:boolean;remaining?:number;reason?:string}>(`/api/chat/balance?provider=${encodeURIComponent(provider)}`);
   if(result.available&&typeof result.remaining==='number')host.textContent=`Balance: $${result.remaining.toFixed(2)}`;
   else host.title=result.reason||'Unavailable';
 }catch { /* no fabricated balance */ }
}
'''


def patch_adapter(src: str) -> str:
    name='hermes_life/hermes_adapter.py'
    src=replace_once(src, 'def _agent_command(toolsets=None):', 'def _agent_command(toolsets=None, provider=None, model=None):',name)
    src=replace_once(src, "    if toolsets:\n        command += ' -t ' + toolsets\n    return command", "    if toolsets:\n        command += ' -t ' + toolsets\n    if provider:\n        command += ' --provider ' + shlex.quote(provider)\n    if model:\n        command += ' --model ' + shlex.quote(model)\n    return command",name)
    src=replace_once(src,"def remote_script(profile='interactive'):","def remote_script(profile='interactive', provider=None, model=None):",name)
    src=replace_once(src,"return _SCRIPT_HEAD + _agent_command(PROFILES[profile]) + '\\n'", "return _SCRIPT_HEAD + _agent_command(PROFILES[profile], provider, model) + '\\n'",name)
    src=replace_once(src,"    def run(self, prompt, event_callback, task_id=None):", "    def run(self, prompt, event_callback, task_id=None, provider=None, model=None):\n        if (provider or model) and self.profile != 'interactive':\n            raise HermesError('Model overrides are restricted to interactive chat')",name)
    src=replace_once(src,"shlex.quote(remote_script(self.profile))", "shlex.quote(remote_script(self.profile, provider, model))",name)
    src=replace_once(src,"command = [self.executable, 'chat', '--query-file', str(file), '--format', 'stream-json']", "command = [self.executable, 'chat', '--query-file', str(file), '--format', 'stream-json']\n                if provider: command.extend(['--provider', provider])\n                if model: command.extend(['--model', model])",name)
    return src


def patch_personality(src: str) -> str:
    name='hermes_life/personality.py'
    src=replace_once(src,"    def run(self, prompt, event_callback, task_id=None):", "    def run(self, prompt, event_callback, task_id=None, **chat_model):",name)
    src=replace_once(src,"return self.delegate.run(prompt,event_callback,task_id)", "return self.delegate.run(prompt,event_callback,task_id,**chat_model) if chat_model else self.delegate.run(prompt,event_callback,task_id)",name)
    src=replace_once(src,"result=self.delegate.run(augmented,collect,task_id)", "result=self.delegate.run(augmented,collect,task_id,**chat_model) if chat_model else self.delegate.run(augmented,collect,task_id)",name)
    return src


def patch_app(src: str) -> str:
    name='hermes_life/app.py'
    src=replace_once(src,"from .study import StudyService, create_study_service", "from .study import StudyService, create_study_service\nfrom .chat_models import ChatModels",name)
    src=replace_once(src,"    revision_text: str | None = None\n", "    revision_text: str | None = None\n    provider: str | None = None\n    model: str | None = None\n",name)
    src=replace_once(src,"        self.store = Store(database)","        self.store = Store(database)\n        self.chat_models = ChatModels(self.store)",name)
    src=replace_once(src,"            def on_event(name, payload):\n                self.store.emit(name, payload, ident)","            choice = self.chat_models.for_task(ident)\n            def on_event(name, payload):\n                if name in ('hermes.result', 'hermes.system') and choice:\n                    self.chat_models.observe(ident, payload)\n                self.store.emit(name, payload, ident)",name)
    src=replace_once(src,"            result = adapter.run(recall + context + prompt, on_event, ident)", "            if choice and scope == 'interactive':\n                result = adapter.run(recall + context + prompt, on_event, ident,\n                                     provider=choice['provider'], model=choice['model'])\n            else:\n                result = adapter.run(recall + context + prompt, on_event, ident)",name)
    src=replace_once(src,"            recover_interrupted(runtime.store.connection)", "            recover_interrupted(runtime.store.connection)\n        runtime.chat_models.migrate()",name)
    # Ensure default-mode tasks retain exact old behavior, but explicit override is saved before worker starts.
    src=replace_once(src,"    @app.post('/api/tasks', status_code=202)", """    @app.get('/api/chat/models')
    def chat_models():
        return {'models': runtime.chat_models.catalog(),
                'default': {'provider': None, 'model': None}}

    @app.get('/api/chat/usage/{task_id}')
    def chat_usage(task_id: str):
        if not runtime.store.task(task_id):
            raise HTTPException(404, 'Task not found')
        return runtime.chat_models.for_task(task_id) or {'task_id': task_id,
                                                         'model': None, 'provider': None,
                                                         'input_tokens': None, 'context_window': None}

    @app.get('/api/chat/balance')
    def chat_balance(provider: str):
        if not any(r['provider'] == provider for r in runtime.chat_models.catalog()):
            raise HTTPException(422, 'Provider is not configured')
        return runtime.chat_models.balance(provider)

    @app.post('/api/tasks', status_code=202)""",name)
    src=replace_once(src,"    def create_task(payload: TaskInput):\n", "    def create_task(payload: TaskInput):\n        try:\n            selected_chat_model = runtime.chat_models.validate(payload.provider, payload.model)\n        except ValueError as exc:\n            raise HTTPException(422, str(exc)) from exc\n",name)
    src=replace_once(src,"            task = runtime.store.create_task(payload.prompt)\n", "            task = runtime.store.create_task(payload.prompt)\n            runtime.chat_models.save(task['id'], selected_chat_model)\n",name)
    return src


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--repo',type=Path,required=True)
    parser.add_argument('--check',action='store_true',help='Check compatibility without writing')
    args=parser.parse_args()
    repo=args.repo.expanduser().resolve()
    operations={
        'frontend/src/hermes-chat.ts':patch_chat,
        'hermes_life/hermes_adapter.py':patch_adapter,
        'hermes_life/personality.py':patch_personality,
        'hermes_life/app.py':patch_app,
    }
    copies={
        'frontend/src/chat-markdown.ts':ROOT/'patches/chat-markdown.ts',
        'frontend/src/chat-upgrade.css':ROOT/'patches/chat-upgrade.css',
        'hermes_life/chat_models.py':ROOT/'patches/chat_models.py',
    }
    results={}
    for rel, fn in operations.items():
        path=repo/rel
        if not path.is_file():
            raise RuntimeError(f'Missing required source: {rel}')
        source=path.read_text()
        if 'HL-CHAT-002' in source:
            raise RuntimeError(f'{rel}: patch appears already present; refusing second install')
        results[rel]=fn(source)
    for rel in copies:
        if (repo/rel).exists():
            raise RuntimeError(f'{rel} already exists; refusing overwrite')
    if args.check:
        print('Compatible with HL-CHAT-002 insertion anchors; no changes made.')
        return
    backup=repo/'.hl-chat-002-backups'/time.strftime('%Y%m%d-%H%M%S')
    backup.mkdir(parents=True,exist_ok=False)
    modified=[]
    try:
        for rel,content in results.items():
            target=repo/rel
            dest=backup/rel;dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(target,dest)
            target.write_text(content)
            modified.append(rel)
        for rel,source in copies.items():
            target=repo/rel;target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(source,target)
            modified.append(rel)
    except Exception:
        for rel in reversed(modified):
            original=backup/rel
            if original.exists():shutil.copy2(original,repo/rel)
            else:(repo/rel).unlink(missing_ok=True)
        raise
    print(f'Installed HL-CHAT-002 ({len(modified)} files). Originals: {backup}')
    print('Next: cd '+str(repo)+'/frontend && npm run build')
    print('Then run your backend tests and restart services using your existing process.')


if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('HL-CHAT-002 NOT installed: '+str(exc),file=sys.stderr)
        sys.exit(1)

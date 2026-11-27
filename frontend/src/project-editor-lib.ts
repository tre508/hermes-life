/** Project editor lib: CodeMirror 6 mounted into the file-editor slot.
 *
 * Phase 4.15's editor was a bare <textarea> — plain text, no syntax
 * highlighting, no wrap control. This module isolates every CodeMirror
 * import so the UI module only sees the small facade below, and so the
 * library is swappable without touching the 1100-line phase412 module.
 *
 * The caller supplies a prefs getter; changing prefs takes effect via
 * refresh(), which reconfigures the compartment-held extensions in place
 * (no editor rebuild, no cursor/history loss).
 */
import {basicSetup, EditorView} from 'codemirror';
import {Compartment, EditorState} from '@codemirror/state';
import {oneDark} from '@codemirror/theme-one-dark';
import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/lang-python';
import {markdown} from '@codemirror/lang-markdown';
import {css} from '@codemirror/lang-css';
import {html} from '@codemirror/lang-html';
import {json} from '@codemirror/lang-json';
import {StreamLanguage} from '@codemirror/language';
import {shell} from '@codemirror/legacy-modes/mode/shell';

export type EditorPrefs={fontSize:number;wrap:boolean;dark:boolean};

export type ProjectEditor={
  /** Full document text (what the save path sends via PUT). */
  get():string;
  /** Replace the document; a path re-picks the highlighter by extension. */
  set(value:string, path?:string):void;
  hasFocus():boolean;
  focus():void;
  /** Re-apply the caller's current prefs in place (compartments). */
  refresh():void;
  /** D4: called once per USER edit (programmatic set() never fires it) — the
   *  caller marks the active document dirty for unsaved indicators. */
  onChange(cb:()=>void):void;
  /** D9: the current selection text (editor-side "Send selection"). */
  selection():string;
  /** D5: the scroll surface for restore-across-tab-switches. */
  scrollTop():number;
  setScrollTop(px:number):void;
};

/** Language support for a path's extension; unknown extensions highlight as plain text. */
function languageFor(path:string){
  const ext=(path.split('.').pop()||'').toLowerCase();
  switch(ext){
    case 'ts':case 'mts':case 'cts':return javascript({typescript:true});
    case 'tsx':case 'jsx':return javascript({typescript:true,jsx:true});
    case 'js':case 'mjs':case 'cjs':return javascript();
    case 'py':case 'pyw':return python();
    case 'md':case 'markdown':return markdown();
    case 'css':return css();
    case 'html':case 'htm':case 'svg':return html();
    case 'json':case 'jsonc':return json();
    case 'sh':case 'bash':case 'zsh':return StreamLanguage.define(shell);
    default:return [];
  }
}

function themeOf(p:EditorPrefs){
  const spec=EditorView.theme({
    '&':{fontSize:p.fontSize+'px'},
    '.cm-scroller':{fontFamily:'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',lineHeight:'1.55'},
  });
  return p.dark?[spec,oneDark]:[spec];
}

/** Mount a CodeMirror editor into `host` and hand back the value facade. */
export function attachProjectEditor(host:HTMLElement,getPrefs:()=>EditorPrefs):ProjectEditor{
  const langConf=new Compartment();
  const themeConf=new Compartment();
  const wrapConf=new Compartment();
  const prefs=getPrefs();
  // D4: user edits vs programmatic set() — the caller's dirty marker must not
  // fire when the lib itself replaces the document (open/save/restore).
  let programmatic=false;
  let userChange:(()=>void)|null=null;
  const view=new EditorView({
    state:EditorState.create({
      doc:'',
      extensions:[
        basicSetup,
        langConf.of(languageFor('')),
        themeConf.of(themeOf(prefs)),
        wrapConf.of(prefs.wrap?EditorView.lineWrapping:[]),
        EditorView.contentAttributes.of({'aria-label':'File editor','spellcheck':'false'}),
        EditorView.updateListener.of((u)=>{
          if(u.docChanged&&!programmatic)userChange?.();
        }),
      ],
    }),
    parent:host,
  });
  return {
    get(){return view.state.doc.toString()},
    set(value,path){
      programmatic=true;
      try{
        view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}});
        if(path!==undefined)view.dispatch({effects:langConf.reconfigure(languageFor(path))});
      }finally{programmatic=false}
    },
    hasFocus(){return view.hasFocus},
    focus(){view.focus()},
    refresh(){
      const p=getPrefs();
      view.dispatch({effects:[
        themeConf.reconfigure(themeOf(p)),
        wrapConf.reconfigure(p.wrap?EditorView.lineWrapping:[]),
      ]});
    },
    onChange(cb){userChange=cb},
    selection(){
      const r=view.state.selection.main;
      return view.state.doc.sliceString(r.from,r.to);
    },
    scrollTop(){return view.scrollDOM.scrollTop},
    setScrollTop(px){view.scrollDOM.scrollTop=px},
  };
}

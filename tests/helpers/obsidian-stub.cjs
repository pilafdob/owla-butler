// Test-only stand-in for the `obsidian` and `electron` runtime modules.
// The real packages ship types only (obsidian) or exist only inside the app (electron),
// so main.ts cannot be loaded in Node without this. Classes are bare; tests give
// instances whatever state a code path needs.
'use strict';
class Base{constructor(...args){this.args=args;}}
class Component extends Base{register(){}registerEvent(){}registerDomEvent(){}registerInterval(){}addChild(c){return c;}}
class Plugin extends Component{constructor(app,manifest){super();this.app=app;this.manifest=manifest;}}
class View extends Component{constructor(leaf){super();this.leaf=leaf;this.app=leaf&&leaf.app;}}
class ItemView extends View{}
class Modal extends Base{constructor(app){super();this.app=app;}open(){}close(){}onClose(){}}
class FuzzySuggestModal extends Modal{setPlaceholder(){}}
class PluginSettingTab extends Base{}
class TAbstractFile{constructor(path=''){this.path=path;this.name=path.split('/').pop();}}
class TFile extends TAbstractFile{constructor(path=''){super(path);const n=this.name;const i=n.lastIndexOf('.');this.extension=i<0?'':n.slice(i+1);this.basename=i<0?n:n.slice(0,i);}}
class TFolder extends TAbstractFile{constructor(path='',children=[]){super(path);this.children=children;}}
class FileSystemAdapter{constructor(base){this.base=base;}getBasePath(){return this.base;}}
class MarkdownView extends ItemView{}
const noop=()=>{};
module.exports={
 App:Base,Plugin,Component,View,ItemView,WorkspaceLeaf:Base,MarkdownView,TAbstractFile,TFile,TFolder,FileSystemAdapter,
 PluginSettingTab,SettingTab:Base,Setting:Base,SettingDefinitionItem:Base,ButtonComponent:Base,Notice:class Notice extends Base{},
 Modal,FuzzySuggestModal,MarkdownRenderer:{render:async()=>{}},Editor:Base,Menu:Base,
 setIcon:noop,setTooltip:noop,addIcon:noop,loadPdfJs:async()=>({}),getLanguage:()=>'en',
 parseLinktext:linktext=>{const i=linktext.indexOf('#');return i<0?{path:linktext,subpath:''}:{path:linktext.slice(0,i),subpath:linktext.slice(i)};},
 parseYaml:()=>({}),stringifyYaml:()=>'',resolveSubpath:()=>null,getAllTags:()=>[],editorInfoField:{},
 // electron
 shell:{openExternal:async()=>{}},webUtils:{getPathForFile:()=>''},
};

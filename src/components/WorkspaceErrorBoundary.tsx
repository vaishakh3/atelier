import {Component} from 'react';
import type {ReactNode,ErrorInfo} from 'react';
export default class WorkspaceErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(_error:Error,_info:ErrorInfo){console.error('Atelier workspace rendering failed. Saved project data was not changed.');}
 render(){if(this.state.failed)return <main className="workspace-failure"><h1>The workspace needs to reopen</h1><p>The local project engine keeps your saved revisions. Reopen the workspace to recover the last saved model.</p><button className="button primary" onClick={()=>window.location.reload()}>Reopen workspace</button></main>;return this.props.children;}
}

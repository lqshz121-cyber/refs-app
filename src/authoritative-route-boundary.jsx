import React, {Component} from 'react';
import {StateBlock} from './ui.jsx';

// O08: a render-time failure inside one routed workspace must not blank the
// whole shell. The root boundary (app.jsx) still exists as the last line of
// defence; this boundary keeps the navigation, scope bar and every other route
// usable, names the failed route with a stable code and the release stamp, and
// offers a retry that remounts only this route. It never renders figures.
const releaseStamp=()=>{try{const sha=globalThis.__BUILD?.sha;return sha?String(sha).slice(0,12):'unknown';}catch{return 'unknown';}};
export class AuthoritativeRouteBoundary extends Component{
  constructor(props){super(props);this.state={failed:false,attempt:0,message:null};}
  static getDerivedStateFromError(error){return {failed:true,message:typeof error?.message==='string'?error.message.slice(0,200):null};}
  componentDidCatch(error){try{this.props.onError?.({route:this.props.route,code:'ROUTE_RENDER_FAILED',message:error?.message});}catch{}}
  componentDidUpdate(previous){if(previous.route!==this.props.route&&this.state.failed)this.setState({failed:false,message:null});}
  retry=()=>this.setState(state=>({failed:false,message:null,attempt:state.attempt+1}));
  render(){
    if(this.state.failed){
      const route=this.props.route||'unknown';
      return <StateBlock tone="error" title={`ROUTE_RENDER_FAILED — the "${route}" page could not render`} actions={<button type="button" className="btn btn-sm" onClick={this.retry}>Retry this page</button>}>
        <p>This page failed while rendering; navigation and every other page keep working. Nothing shown here is accounting evidence, and no figure was substituted.</p>
        <p>Code: <code>ROUTE_RENDER_FAILED</code> · route <code>{route}</code> · release <code>{releaseStamp()}</code>{this.state.message?<> · <span className="muted sm">{this.state.message}</span></>:null}</p>
      </StateBlock>;
    }
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}

import App from '../App';
import AuthScreen from './AuthScreen';
import {useAuth} from '../domain/auth';

export default function WorkspaceHost(){
 const auth=useAuth();
 const locked=auth.loading||Boolean(auth.error)||(auth.identityRequired&&!auth.authenticated);
 const hasWorkspace=!auth.loading&&(!auth.identityRequired||Boolean(auth.sessionUser));
 return <>{locked&&<AuthScreen/>}{hasWorkspace&&<div hidden={locked} inert={locked} className="authenticated-workspace"><App key={(auth.sessionUser?.id||'development')+'/'+auth.generation}/></div>}</>;
}

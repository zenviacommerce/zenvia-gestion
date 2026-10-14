import { Check } from 'lucide-react';
import '../../shared-forms.css';

export function CheckboxOption({checked,onChange,label,description,disabled=false}:{checked:boolean;onChange:(checked:boolean)=>void;label:string;description?:string;disabled?:boolean}){
  return <label className={`sharedCheckboxOption ${checked?'isSelected':''} ${disabled?'isDisabled':''}`}>
    <span className="sharedCheckboxControl"><input type="checkbox" checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/><Check size={13} aria-hidden="true"/></span>
    <span className="sharedCheckboxText">{label}{description&&<small>{description}</small>}</span>
  </label>;
}

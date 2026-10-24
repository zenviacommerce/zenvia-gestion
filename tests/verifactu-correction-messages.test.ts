import {it,expect} from 'vitest';
import {correctionErrorMessage} from '../src/services/salesRectifying';
it('explains guarded fiscal actions with a usable correction alternative',()=>{
 expect(correctionErrorMessage({message:'VF_FISCAL_IMMUTABLE'})).toMatch(/rectificativa/);
 expect(correctionErrorMessage({message:'VF_CORRECTION_TARGET_SUPERSEDED'})).toMatch(/última rectificativa/);
 expect(correctionErrorMessage({message:'VF_ACTIVE_CORRECTIONS'})).toMatch(/vinculadas/);
 expect(correctionErrorMessage(new Error('Sin conexión'))).toBe('Sin conexión');
});

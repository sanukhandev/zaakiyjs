import type {AuthRepository} from "../models/auth";
import {createAuthViewModel} from "../viewmodels/createAuthViewModel";
/** Replace the fail-closed repository at composition time; never in the View. */
export function createAuthPage(repository:AuthRepository){return createAuthViewModel(repository);}

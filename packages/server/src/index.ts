import { emailHandler } from './handler/email';
import { fetchHandler } from './handler/fetch';
import { scheduledHandler } from './handler/scheduled';
import './polyfill';

export default {
    fetch: fetchHandler,
    email: emailHandler,
    scheduled: scheduledHandler,
};

import { useNavigate, useParams } from 'react-router-dom';
import { MessageReader } from '../components/ios/MessageReader';

/**
 * Standalone message detail screen used by the Mini App deep link
 * `#/mail/:id` (the Open button on a Telegram notification).
 *
 * It renders the reader directly instead of going through the inbox, so the
 * link works no matter which folder holds the message. The native back button
 * returns to the inbox list.
 */
export function MailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const back = () => navigate('/inbox');

    if (!id) {
        return <div className="reader-empty">Message not found.</div>;
    }

    return (
        <div className="split-column">
            <MessageReader key={id} emailId={id} onBack={back} onDeleted={back} />
        </div>
    );
}

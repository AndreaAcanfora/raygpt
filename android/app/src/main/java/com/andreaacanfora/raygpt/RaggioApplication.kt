package com.andreaacanfora.raygpt

import android.app.Application
import com.andreaacanfora.raygpt.conversation.ConversationController

class RaggioApplication : Application() {
    /** One conversation per process, shared by the activity and the foreground service. */
    val conversation by lazy { ConversationController(this) }
}
